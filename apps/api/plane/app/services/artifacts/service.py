"""Shared artifact authorization, lifecycle, snapshot, and rendering services."""
from urllib.parse import urlparse

from django.db import transaction
from django.db.models import Q
from django.utils import timezone
from rest_framework.exceptions import APIException, NotFound, PermissionDenied, ValidationError

from plane.app.permissions import ROLE
from plane.db.models import (
    Artifact, ArtifactCategory, ArtifactMaterial, ArtifactRevision, ArtifactSource,
    FileAsset, Issue, ProjectMember, Workspace, WorkspaceMember,
)


class Conflict(APIException):
    status_code = 409
    default_detail = "该成果已被其他人修改，请重新加载后再试。"
    default_code = "version_conflict"


def member_role(user, workspace):
    return WorkspaceMember.objects.filter(workspace=workspace, member=user, is_active=True, deleted_at__isnull=True).values_list("role", flat=True).first()


def can_project(user, issue):
    return ProjectMember.objects.filter(project_id=issue.project_id, workspace_id=issue.workspace_id, member=user, is_active=True, deleted_at__isnull=True).exists()


def require_workspace(user, workspace):
    if member_role(user, workspace) is None:
        raise NotFound()


def can_edit(user, artifact):
    role = member_role(user, artifact.workspace)
    return role == ROLE.ADMIN.value or (role == ROLE.MEMBER.value and (artifact.access == Artifact.Access.WORKSPACE or artifact.owner_id == user.id))


def active_artifact(user, workspace, artifact_id, write=False):
    require_workspace(user, workspace)
    obj = Artifact.objects.filter(id=artifact_id, workspace=workspace, deleted_at__isnull=True).first()
    if obj is None:
        raise NotFound()
    if write and not can_edit(user, obj):
        raise PermissionDenied()
    return obj


def _validate_url(url):
    parsed = urlparse(url or "")
    if parsed.scheme not in ("http", "https") or not parsed.netloc or parsed.username or parsed.password:
        raise ValidationError({"links": "链接必须是安全的 http 或 https 地址。"})
    return url


def _source_rows(user, workspace, issue_ids):
    ids = list(dict.fromkeys(issue_id for issue_id in (issue_ids or []) if issue_id))
    issues = list(Issue.issue_objects.filter(id__in=ids, workspace=workspace, deleted_at__isnull=True).select_related("project"))
    if len(issues) != len(ids) or any(not can_project(user, issue) for issue in issues):
        raise PermissionDenied("来源任务不存在或不可访问。")
    return issues


def _asset(user, workspace, asset_id, artifact=None):
    asset = FileAsset.objects.filter(id=asset_id, workspace=workspace, is_uploaded=True, is_deleted=False, deleted_at__isnull=True).first()
    if asset is None:
        raise ValidationError({"assets": "附件不存在或已失效。"})
    if asset.entity_type == FileAsset.EntityTypeContext.ARTIFACT_ATTACHMENT:
        if artifact is None or str(asset.entity_identifier) != str(artifact.id):
            raise PermissionDenied("成果上传附件只能用于其所属成果。")
        role = member_role(user, workspace)
        was_published = False
        if artifact.published_revision_id:
            published = artifact.published_revision.snapshot
            was_published = str(asset.id) in {str(m.get("asset_id")) for m in published.get("materials", [])} or str(asset.id) == str((published.get("cover") or {}).get("asset_id"))
        selected_in_draft = artifact.materials.filter(asset_id=asset.id).exists()
        if asset.user_id != user.id and role != ROLE.ADMIN.value and not (was_published or selected_in_draft):
            raise PermissionDenied("私有成果附件仅上传者、管理员或已发布材料的维护者可选择。")
        return asset
    issue_id = asset.issue_id or (asset.comment.issue_id if asset.comment_id else None)
    issue = Issue.issue_objects.filter(id=issue_id, workspace=workspace, deleted_at__isnull=True).first() if issue_id else None
    if issue is None or not can_project(user, issue):
        raise PermissionDenied("附件来源项目不可访问。")
    return asset


def _serialize_source(issue, slug):
    return {"id": str(issue.id), "sequence_id": issue.sequence_id, "name": issue.name,
            "project_id": str(issue.project_id), "project_name": issue.project.name,
            "identifier": f"{issue.project.identifier}-{issue.sequence_id}",
            "url": f"/{slug}/browse/{issue.project.identifier}-{issue.sequence_id}/"}


def snapshot(artifact, slug):
    sources = []
    unavailable = 0
    for row in artifact.sources.select_related("issue__project"):
        issue = row.issue
        if issue is None or issue.deleted_at is not None:
            unavailable += 1
        else:
            sources.append(_serialize_source(issue, slug))
    materials = []
    for item in artifact.materials.select_related("asset"):
        asset = item.asset
        if item.url:
            materials.append({"title": item.title, "url": item.url, "kind": item.kind, "asset_id": None})
        elif asset and asset.is_uploaded and not asset.is_deleted and asset.deleted_at is None:
            name = asset.attributes.get("name", item.title)
            materials.append({"title": item.title or name, "url": None, "kind": item.kind, "asset_id": str(asset.id), "name": name,
                              "size": int(asset.attributes.get("size", asset.size or 0)),
                              "mime": asset.attributes.get("type", "application/octet-stream")})
        else:
            unavailable += 1
    cover = None
    if artifact.cover_asset and artifact.cover_asset.is_uploaded and not artifact.cover_asset.is_deleted and artifact.cover_asset.deleted_at is None:
        cover = {"asset_id": str(artifact.cover_asset_id), "name": artifact.cover_asset.attributes.get("name", "封面")}
    elif artifact.cover_asset_id:
        unavailable += 1
    return {"id": str(artifact.id), "title": artifact.title, "summary": artifact.summary, "category": artifact.category.name if artifact.category and not artifact.category.deleted_at else None,
            "category_id": str(artifact.category_id) if artifact.category_id else None, "kind": artifact.kind,
            "sources": sources, "source_issue_ids": [item["id"] for item in sources],
            "assets": [{"id": item["asset_id"], "name": item["name"], "size": item["size"], "type": item["mime"]} for item in materials if item.get("asset_id")],
            "links": [{"title": item["title"], "url": item["url"], "kind": item["kind"]} for item in materials if item.get("url")],
            "materials": materials, "primary_action": artifact.primary_action, "cover": cover,
            "updated_at": artifact.updated_at.isoformat(), "version": artifact.version, "unavailable_reference_count": unavailable}


def _apply_body(artifact, user, data, create=False):
    issues = _source_rows(user, artifact.workspace, data.get("source_issue_ids", []))
    assets = [_asset(user, artifact.workspace, entry["id"] if isinstance(entry, dict) else entry, artifact) for entry in data.get("assets", [])]
    cover = _asset(user, artifact.workspace, data["cover_asset_id"], artifact) if data.get("cover_asset_id") else None
    category = None
    if data.get("category_id"):
        category = ArtifactCategory.objects.filter(id=data["category_id"], workspace=artifact.workspace, deleted_at__isnull=True).first()
        if category is None:
            raise ValidationError({"category_id": "分类不存在。"})
    links = data.get("links", [])
    for link in links:
        _validate_url(link.get("url"))
    action = data.get("primary_action") or {"type": "detail", "label": "查看详情"}
    if action.get("type") not in ("detail", "attachment", "link"):
        raise ValidationError({"primary_action": "操作类型无效。"})
    if action.get("type") == "link":
        _validate_url(action.get("url"))
        if not any(l.get("url") == action["url"] for l in links):
            raise ValidationError({"primary_action": "主链接必须出现在链接材料中。"})
    if action.get("type") == "attachment" and str(action.get("attachment_id")) not in {str(a.id) for a in assets}:
        raise ValidationError({"primary_action": "主附件必须在所选材料中。"})
    artifact.title = str(data.get("title", artifact.title)).strip()
    artifact.summary = data.get("summary", artifact.summary)
    artifact.kind = str(data.get("kind", artifact.kind)).strip()
    artifact.category = category
    artifact.cover_asset = cover
    artifact.primary_action = action
    if not artifact.title or not artifact.kind:
        raise ValidationError({"title": "名称和类型必填。"})
    artifact.save(update_fields=["title", "summary", "kind", "category", "cover_asset", "primary_action", "updated_at"])
    artifact.sources.all().delete()
    ArtifactSource.objects.bulk_create([ArtifactSource(artifact=artifact, issue=i) for i in issues])
    artifact.materials.all().delete()
    material_rows = [ArtifactMaterial(artifact=artifact, asset=a, title=a.attributes.get("name", "附件"), kind="attachment", position=n) for n, a in enumerate(assets)]
    material_rows += [ArtifactMaterial(artifact=artifact, title=l["title"], url=l["url"], kind=l.get("kind", "reference"), position=len(material_rows)+n) for n, l in enumerate(links)]
    ArtifactMaterial.objects.bulk_create(material_rows)


@transaction.atomic
def create_artifact(user, workspace, data):
    require_workspace(user, workspace)
    if member_role(user, workspace) not in (ROLE.ADMIN.value, ROLE.MEMBER.value):
        raise PermissionDenied()
    obj = Artifact(workspace=workspace, owner=user, title="暂存", kind="未分类")
    obj.save()
    _apply_body(obj, user, data, create=True)
    return obj


def _lock_version(artifact, version):
    if version is None:
        raise ValidationError({"version": "必须提供成果版本号。"})
    try:
        parsed = int(version)
    except (TypeError, ValueError):
        raise ValidationError({"version": "成果版本号必须是整数。"})
    if parsed != artifact.version:
        raise Conflict()


@transaction.atomic
def update_artifact(user, artifact, data):
    artifact = Artifact.objects.select_for_update().get(pk=artifact.pk)
    _lock_version(artifact, data.get("version"))
    _apply_body(artifact, user, data)
    artifact.version += 1
    artifact.save(update_fields=["version", "updated_at"])
    return artifact


def render_authorized_asset(user, artifact, revision, asset_id):
    require_workspace(user, artifact.workspace)
    if artifact.deleted_at or artifact.workspace.deleted_at:
        raise NotFound()
    if artifact.status == Artifact.Status.PUBLISHED and artifact.access == Artifact.Access.PRIVATE and not can_edit(user, artifact):
        raise NotFound()
    sources = []
    for source in revision.snapshot.get("sources", []):
        issue = Issue.issue_objects.filter(id=source["id"], workspace=artifact.workspace, deleted_at__isnull=True).first()
        if not issue or not can_project(user, issue):
            raise NotFound()
        sources.append(issue)
    snap = revision.snapshot
    selected = {m.get("asset_id") for m in snap.get("materials", [])}
    if snap.get("cover"):
        selected.add(snap["cover"].get("asset_id"))
    if str(asset_id) not in selected:
        raise NotFound()
    asset = FileAsset.objects.filter(id=asset_id, workspace=artifact.workspace, is_uploaded=True, is_deleted=False, deleted_at__isnull=True).first()
    if asset is None:
        raise NotFound()
    if asset.entity_type == FileAsset.EntityTypeContext.ARTIFACT_ATTACHMENT:
        if str(asset.entity_identifier) != str(artifact.id):
            raise NotFound()
    else:
        issue_id = asset.issue_id or (asset.comment.issue_id if asset.comment_id else None)
        issue = next((i for i in sources if str(i.id) == str(issue_id)), None)
        if not issue:
            raise NotFound()
    return asset


def published_snapshot(artifact, user):
    if artifact.status != Artifact.Status.PUBLISHED or (artifact.access == Artifact.Access.PRIVATE and not can_edit(user, artifact)):
        raise NotFound()
    revision = artifact.published_revision
    if not revision:
        return None
    snap = dict(revision.snapshot)
    snap["published_version"] = revision.number
    snap["status"] = artifact.status
    snap["category"] = snap.get("category")
    # Report broken references explicitly; a missing private source denies the whole result.
    referenced_assets = [m.get("asset_id") for m in snap.get("materials", []) if m.get("asset_id")]
    if (snap.get("cover") or {}).get("asset_id"):
        referenced_assets.append(snap["cover"]["asset_id"])
    unavailable_assets = 0
    for asset_id in referenced_assets:
        asset = FileAsset.objects.filter(id=asset_id, workspace=artifact.workspace, is_uploaded=True, is_deleted=False, deleted_at__isnull=True).first()
        if asset is None or (asset.entity_type == FileAsset.EntityTypeContext.ARTIFACT_ATTACHMENT and str(asset.entity_identifier) != str(artifact.id)):
            unavailable_assets += 1
    snap["unavailable_reference_count"] = unavailable_assets
    unavailable = snap.get("unavailable_reference_count", 0)
    for source in snap.get("sources", []):
        issue = Issue.issue_objects.filter(id=source["id"], workspace=artifact.workspace, deleted_at__isnull=True).first()
        if issue is None:
            retained = Issue.all_objects.filter(id=source["id"], workspace=artifact.workspace).first()
            if retained is None or retained.deleted_at is not None:
                unavailable += 1
                continue
            raise NotFound()
        if not can_project(user, issue):
            raise NotFound()
    snap["unavailable_reference_count"] = unavailable
    return snap


@transaction.atomic
def publish_artifact(user, artifact, version):
    artifact = Artifact.objects.select_for_update().get(pk=artifact.pk)
    _lock_version(artifact, version)
    if not can_edit(user, artifact):
        raise PermissionDenied()
    if artifact.sources.filter(issue__isnull=True).exists():
        raise ValidationError({"source_issue_ids": "存在已删除的来源任务，请先移除该来源。"})
    _source_rows(user, artifact.workspace, list(artifact.sources.values_list("issue_id", flat=True)))
    for item in artifact.materials.select_related("asset"):
        if item.asset_id:
            _asset(user, artifact.workspace, item.asset_id, artifact)
    if artifact.cover_asset_id:
        _asset(user, artifact.workspace, artifact.cover_asset_id, artifact)
    snap = snapshot(artifact, artifact.workspace.slug)
    if snap["unavailable_reference_count"]:
        raise ValidationError({"materials": "存在已失效的来源或材料，请先修复草稿。"})
    if not snap["materials"]:
        raise ValidationError({"materials": "发布前至少需要一个可用附件或链接。"})
    rev = ArtifactRevision.objects.create(artifact=artifact, number=artifact.revisions.count()+1, snapshot=snap, actor=user)
    artifact.published_revision = rev
    artifact.status = Artifact.Status.PUBLISHED
    artifact.access = Artifact.Access.WORKSPACE
    artifact.version += 1
    artifact.save(update_fields=["published_revision", "status", "access", "version", "updated_at"])
    return artifact


@transaction.atomic
def transition_artifact(user, artifact, version, status_value):
    artifact = Artifact.objects.select_for_update().get(pk=artifact.pk)
    _lock_version(artifact, version)
    if not can_edit(user, artifact):
        raise PermissionDenied()
    artifact.status = status_value
    artifact.version += 1
    artifact.save(update_fields=["status", "version", "updated_at"])
    return artifact


def serialize_artifact(artifact, user, view="published"):
    draft_snap = snapshot(artifact, artifact.workspace.slug)
    if view == "draft" and can_edit(user, artifact):
        for row in artifact.sources.select_related("issue__project"):
            if row.issue.deleted_at is None and not can_project(user, row.issue):
                raise NotFound()
        snap = draft_snap
    else:
        snap = published_snapshot(artifact, user)
        if snap is None:
            raise NotFound()
    published = artifact.published_revision.snapshot if artifact.published_revision else None
    compare_keys = ("title", "summary", "category_id", "kind", "source_issue_ids", "assets", "links", "primary_action", "cover")
    changed = bool(can_edit(user, artifact) and published and any(draft_snap.get(key) != published.get(key) for key in compare_keys))
    snap.update({"owner_id": str(artifact.owner_id) if artifact.owner_id else None, "status": artifact.status, "version": artifact.version,
                 "access": artifact.access,
                 "has_unpublished_changes": changed,
                 "can_edit": can_edit(user, artifact)})
    # Stable GalleryCard projection is shared by the gallery, editor preview, and detail route.
    attachments, links = [], []
    from plane.app.views.attachment_preview import is_previewable_asset
    for item in snap.get("materials", []):
        if item.get("asset_id"):
            base_url = f"/api/workspaces/{artifact.workspace.slug}/artifacts/{artifact.id}/assets/{item['asset_id']}/"
            file_url = base_url + ("?view=draft" if view == "draft" else "")
            attachments.append({"id": item["asset_id"], "name": item.get("name", item["title"]), "size": item.get("size", 0),
                                "mime": item.get("mime", "application/octet-stream"), "file_url": file_url,
                                "source_url": base_url + "source/" + ("?view=draft" if view == "draft" else ""), "can_preview": is_previewable_asset(item.get("name", item.get("title", "")), item.get("size", 0))})
        elif item.get("url"):
            links.append({"title": item["title"], "url": item["url"], "kind": item.get("kind", "reference")})
    cover = snap.get("cover")
    if cover:
        cover_url = f"/api/workspaces/{artifact.workspace.slug}/artifacts/{artifact.id}/covers/{cover['asset_id']}/"
        draft_query = "?view=draft" if view == "draft" else ""
        cover.update({"file_url": cover_url + draft_query, "source_url": cover_url + draft_query})
    snap.update({"attachments": attachments, "links": links})
    return snap
