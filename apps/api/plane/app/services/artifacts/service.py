"""Shared artifact authorization, lifecycle, snapshot, and rendering services."""
import uuid
from urllib.parse import urlparse

from django.db import transaction
from django.db.models import Prefetch, Q
from django.utils import timezone
from rest_framework.exceptions import APIException, NotFound, PermissionDenied, ValidationError

from plane.app.permissions import ROLE
from plane.db.models import (
    Artifact, ArtifactCategory, ArtifactMaterial, ArtifactRevision, ArtifactSource,
    FileAsset, Issue, IssueAssignee, ProjectMember, Workspace, WorkspaceMember,
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


def authorize_snapshot_sources(user, workspace, snap):
    """Authorize frozen metadata even when its Issue has been deleted."""
    unavailable = 0
    for source in snap.get("sources", []):
        issue = Issue.all_objects.filter(id=source.get("id"), workspace=workspace).first()
        project_id = issue.project_id if issue else source.get("project_id")
        if not project_id or not ProjectMember.objects.filter(
            project_id=project_id, workspace=workspace, project__deleted_at__isnull=True,
            member=user, is_active=True, deleted_at__isnull=True,
        ).exists():
            raise NotFound()
        if issue is None or issue.deleted_at is not None:
            unavailable += 1
    return unavailable


def authorize_existing_sources(user, artifact):
    """Protect the current draft and publication before replacing either."""
    if artifact.published_revision:
        authorize_snapshot_sources(user, artifact.workspace, artifact.published_revision.snapshot)
    for row in artifact.sources.select_related("issue"):
        if row.issue is not None:
            authorize_snapshot_sources(user, artifact.workspace, {"sources": [{"id": str(row.issue_id)}]})
        else:
            # Scope belongs to this exact reference, never to a different published source.
            authorize_snapshot_sources(user, artifact.workspace, {"sources": [{"project_id": str(row.project_id) if row.project_id else None}]})


def require_artifact_write(user, artifact):
    if not can_edit(user, artifact):
        raise PermissionDenied()
    try:
        authorize_existing_sources(user, artifact)
    except NotFound:
        raise PermissionDenied("成果来源项目不可访问。")


def active_artifact(user, workspace, artifact_id, write=False):
    require_workspace(user, workspace)
    obj = Artifact.objects.filter(id=artifact_id, workspace=workspace, deleted_at__isnull=True).first()
    if obj is None:
        raise NotFound()
    if write:
        require_artifact_write(user, obj)
    return obj


def _validate_url(url):
    try:
        parsed = urlparse(url or "")
        hostname = parsed.hostname
        invalid = parsed.scheme not in ("http", "https") or not parsed.netloc or not hostname or parsed.username or parsed.password
    except (AttributeError, TypeError, ValueError):
        invalid = True
    if invalid:
        raise ValidationError({"links": "链接必须是安全的 http 或 https 地址。"})
    return url


def validate_artifact_payload(data, create=False):
    if not isinstance(data, dict):
        raise ValidationError({"detail": "请求内容必须是对象。"})
    allowed = {"title", "summary", "kind", "category_id", "cover_asset_id", "primary_action", "source_issue_ids", "assignee_ids", "assets", "links", "version"}
    unknown = set(data) - allowed
    if unknown:
        raise ValidationError({"detail": f"不支持的字段：{', '.join(sorted(unknown))}"})
    for field, limit in (("title", 255), ("kind", 80), ("summary", None)):
        if field in data and (not isinstance(data[field], str) or (limit and len(data[field]) > limit)):
            raise ValidationError({field: "字段类型或长度无效。"})
    if create and (not str(data.get("title", "")).strip() or not str(data.get("kind", "")).strip()):
        raise ValidationError({"title": "名称和类型必填。"})

    def check_uuid(value, field, allow_empty=False, nullable=False):
        if value is None:
            if nullable:
                return
            raise ValidationError({field: "必须是有效的 UUID。"})
        if allow_empty and value == "":
            return
        try:
            uuid.UUID(str(value))
        except (TypeError, ValueError, AttributeError):
            raise ValidationError({field: "必须是有效的 UUID。"})

    for field in ("category_id", "cover_asset_id"):
        if field in data:
            check_uuid(data[field], field, allow_empty=True, nullable=True)
    for field in ("source_issue_ids", "assignee_ids"):
        if field in data:
            values = data[field]
            if not isinstance(values, list):
                raise ValidationError({field: "必须是 UUID 列表。"})
            for value in values:
                check_uuid(value, field)
    if "assets" in data:
        values = data["assets"]
        if not isinstance(values, list):
            raise ValidationError({"assets": "必须是附件列表。"})
        for value in values:
            if isinstance(value, dict):
                if "id" not in value:
                    raise ValidationError({"assets": "每个附件必须包含 id 字段。"})
                value = value.get("id")
            check_uuid(value, "assets")
    if "links" in data:
        values = data["links"]
        if not isinstance(values, list):
            raise ValidationError({"links": "必须是链接列表。"})
        for item in values:
            if not isinstance(item, dict) or not isinstance(item.get("title"), str) or not isinstance(item.get("url"), str):
                raise ValidationError({"links": "每个链接必须包含标题和 URL。"})
            if len(item["title"]) > 255 or len(item["url"]) > 2000 or ("kind" in item and not isinstance(item["kind"], str)):
                raise ValidationError({"links": "链接字段类型或长度无效。"})
            if len(item.get("kind", "reference")) > 40:
                raise ValidationError({"links": "链接类型过长。"})
    if "primary_action" in data and data["primary_action"] is not None:
        action = data["primary_action"]
        if not isinstance(action, dict) or action.get("type") not in ("detail", "attachment", "link"):
            raise ValidationError({"primary_action": "操作类型无效。"})
        if not isinstance(action.get("label"), str) or len(action["label"]) > 80:
            raise ValidationError({"primary_action": "操作标签必须是长度不超过 80 的文本。"})
        if action["type"] == "attachment":
            check_uuid(action.get("attachment_id"), "primary_action")
        if action["type"] == "link" and not isinstance(action.get("url"), str):
            raise ValidationError({"primary_action": "链接操作必须包含 URL。"})
    if "version" in data and (isinstance(data["version"], bool) or not isinstance(data["version"], (int, str))):
        raise ValidationError({"version": "版本号必须是整数。"})


def _source_rows(user, workspace, issue_ids):
    ids = list(dict.fromkeys(issue_id for issue_id in (issue_ids or []) if issue_id))
    issues = list(Issue.issue_objects.filter(id__in=ids, workspace=workspace, deleted_at__isnull=True).select_related("project"))
    if len(issues) != len(ids) or any(not can_project(user, issue) for issue in issues):
        raise PermissionDenied("来源任务不存在或不可访问。")
    by_id = {str(issue.id): issue for issue in issues}
    return [by_id[str(issue_id)] for issue_id in ids]


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


def _validate_asset_sources(assets, source_ids):
    allowed = {str(issue_id) for issue_id in source_ids if issue_id}
    for asset in assets:
        if asset.entity_type == FileAsset.EntityTypeContext.ARTIFACT_ATTACHMENT:
            continue
        issue_id = asset.issue_id or (asset.comment.issue_id if asset.comment_id else None)
        if issue_id is None or str(issue_id) not in allowed:
            raise ValidationError({"assets": "附件来源必须包含在所选来源任务中。"})


def validated_assignee_ids(workspace, values):
    ids = sorted({str(value) for value in values})
    valid = {str(value) for value in WorkspaceMember.objects.filter(workspace=workspace, member_id__in=ids, is_active=True, deleted_at__isnull=True, member__is_active=True).values_list("member_id", flat=True)}
    if set(ids) != valid:
        raise ValidationError({"assignee_ids": "负责人必须是当前工作区的有效成员。"})
    return ids


def source_assignee_ids(issue):
    active_members = WorkspaceMember.objects.filter(workspace_id=issue.workspace_id, is_active=True, deleted_at__isnull=True, member__is_active=True).values_list("member_id", flat=True)
    return sorted({str(value) for value in IssueAssignee.objects.filter(issue=issue, deleted_at__isnull=True, assignee_id__in=active_members).values_list("assignee_id", flat=True)})


def artifact_read_queryset(queryset):
    """Load artifact relations once so collection serializers do not issue per-row queries."""
    return queryset.select_related("workspace", "published_revision", "category", "cover_asset", "owner").prefetch_related(
        Prefetch("sources", queryset=ArtifactSource.objects.select_related("issue__project").order_by("created_at", "id"), to_attr="_artifact_read_sources"),
        Prefetch("materials", queryset=ArtifactMaterial.objects.select_related("asset").order_by("position", "created_at"), to_attr="_artifact_read_materials"),
        Prefetch("assignees", to_attr="_artifact_read_assignees"),
    )


class ArtifactReadContext:
    """Request-local, workspace-scoped authorization and lookup maps for a collection read."""

    def __init__(self, user, workspace, artifacts, role=None):
        self.user = user
        self.workspace = workspace
        self.role = role if role is not None else member_role(user, workspace)
        artifacts = list(artifacts)
        source_rows = [row for artifact in artifacts for row in self._sources(artifact)]
        materials = [item for artifact in artifacts for item in self._materials(artifact)]

        issue_ids = {str(row.issue_id) for row in source_rows if row.issue_id}
        asset_ids = {str(item.asset_id) for item in materials if item.asset_id}
        category_ids = {str(artifact.category_id) for artifact in artifacts if artifact.category_id}
        for artifact in artifacts:
            revision = artifact.published_revision
            if not revision:
                continue
            snap = revision.snapshot or {}
            category_id = snap.get("category_id")
            if category_id:
                category_ids.add(category_id)
            for source in snap.get("sources", []):
                if source.get("id"):
                    issue_ids.add(str(source["id"]))
            asset_ids.update(str(item["asset_id"]) for item in snap.get("materials", []) if item.get("asset_id"))
            if (snap.get("cover") or {}).get("asset_id"):
                asset_ids.add(str(snap["cover"]["asset_id"]))

        projects = ProjectMember.objects.filter(
            workspace=workspace, member=user, is_active=True, deleted_at__isnull=True,
            project__deleted_at__isnull=True,
        ).values_list("project_id", flat=True)
        self.project_ids = {str(value) for value in projects}
        self.issues = {
            str(issue.id): issue
            for issue in Issue.all_objects.filter(id__in=issue_ids, workspace=workspace).select_related("project")
        }
        self.assets = {
            str(asset.id): asset
            for asset in FileAsset.objects.filter(
                id__in=asset_ids, workspace=workspace, is_uploaded=True, is_deleted=False, deleted_at__isnull=True,
            )
        }
        self.categories = {
            str(category.id): category
            for category in ArtifactCategory.objects.filter(id__in=category_ids, workspace=workspace, deleted_at__isnull=True)
        }
        active_members = WorkspaceMember.objects.filter(
            workspace=workspace, is_active=True, deleted_at__isnull=True, member__is_active=True,
        ).values_list("member_id", flat=True)
        self.source_assignees = {}
        if issue_ids:
            for issue_id, user_id in IssueAssignee.objects.filter(
                issue_id__in=issue_ids, deleted_at__isnull=True, assignee_id__in=active_members,
            ).values_list("issue_id", "assignee_id").distinct():
                self.source_assignees.setdefault(str(issue_id), set()).add(str(user_id))

    @staticmethod
    def _sources(artifact):
        if hasattr(artifact, "_artifact_read_sources"):
            return artifact._artifact_read_sources
        return artifact.sources.select_related("issue__project").order_by("created_at", "id")

    @staticmethod
    def _materials(artifact):
        if hasattr(artifact, "_artifact_read_materials"):
            return artifact._artifact_read_materials
        return artifact.materials.select_related("asset").order_by("position", "created_at")

    def valid_published_asset(self, asset_id, artifact):
        asset = self.assets.get(str(asset_id))
        return bool(asset and (asset.entity_type != FileAsset.EntityTypeContext.ARTIFACT_ATTACHMENT
                               or str(asset.entity_identifier) == str(artifact.id)))

    def authorize_snapshot(self, snap):
        unavailable = 0
        for source in snap.get("sources", []):
            issue = self.issues.get(str(source.get("id"))) if source.get("id") else None
            project_id = issue.project_id if issue else source.get("project_id")
            if not project_id or str(project_id) not in self.project_ids:
                raise NotFound()
            if issue is None or issue.deleted_at is not None:
                unavailable += 1
        return unavailable

    def authorize_existing(self, artifact):
        if artifact.published_revision:
            self.authorize_snapshot(artifact.published_revision.snapshot)
        for row in self._sources(artifact):
            source = {"id": str(row.issue_id)} if row.issue_id else {"project_id": str(row.project_id) if row.project_id else None}
            self.authorize_snapshot({"sources": [source]})

    def can_edit(self, artifact):
        return self.role == ROLE.ADMIN.value or (
            self.role == ROLE.MEMBER.value
            and (artifact.access == Artifact.Access.WORKSPACE or artifact.owner_id == self.user.id)
        )


def _serialize_source(issue, slug, read_context=None):
    assignee_ids = sorted(read_context.source_assignees.get(str(issue.id), set())) if read_context else source_assignee_ids(issue)
    return {"id": str(issue.id), "sequence_id": issue.sequence_id, "name": issue.name, "assignee_ids": assignee_ids,
            "project_id": str(issue.project_id), "project_name": issue.project.name,
            "identifier": f"{issue.project.identifier}-{issue.sequence_id}",
            "url": f"/{slug}/browse/{issue.project.identifier}-{issue.sequence_id}/"}


def snapshot(artifact, slug, read_context=None):
    sources = []
    unavailable = 0
    source_rows = read_context._sources(artifact) if read_context else artifact.sources.select_related("issue__project").order_by("created_at", "id")
    for row in source_rows:
        issue = row.issue
        if issue is None or issue.deleted_at is not None:
            unavailable += 1
        else:
            sources.append(_serialize_source(issue, slug, read_context))
    materials = []
    material_rows = read_context._materials(artifact) if read_context else artifact.materials.select_related("asset")
    for item in material_rows:
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
    assignees = getattr(artifact, "_artifact_read_assignees", None)
    if assignees is None:
        assignee_ids = list(artifact.assignees.values_list("id", flat=True))
    else:
        assignee_ids = [assignee.id for assignee in assignees]
    return {"id": str(artifact.id), "title": artifact.title, "summary": artifact.summary, "category": artifact.category.name if artifact.category and not artifact.category.deleted_at else None,
            "category_id": str(artifact.category_id) if artifact.category_id else None, "kind": artifact.kind,
            "sources": sources, "source_issue_ids": [item["id"] for item in sources],
            "assignee_ids": sorted(str(value) for value in assignee_ids),
            "assets": [{"id": item["asset_id"], "name": item["name"], "size": item["size"], "type": item["mime"]} for item in materials if item.get("asset_id")],
            "links": [{"title": item["title"], "url": item["url"], "kind": item["kind"]} for item in materials if item.get("url")],
            "materials": materials, "primary_action": artifact.primary_action, "cover": cover,
            "updated_at": artifact.updated_at.isoformat(), "version": artifact.version, "unavailable_reference_count": unavailable}


def _apply_body(artifact, user, data, create=False):
    assignee_ids = validated_assignee_ids(artifact.workspace, data.get("assignee_ids", [])) if create or "assignee_ids" in data else None
    existing_materials = list(artifact.materials.select_related("asset").order_by("position", "created_at"))
    sources_changed = create or "source_issue_ids" in data
    assets_changed = create or "assets" in data
    links_changed = create or "links" in data
    if sources_changed:
        source_ids = data.get("source_issue_ids", [])
    else:
        source_ids = list(artifact.sources.values_list("issue_id", flat=True))
        if any(issue_id is None for issue_id in source_ids):
            raise ValidationError({"source_issue_ids": "来源已失效，请显式替换或移除后再保存。"})
    issues = _source_rows(user, artifact.workspace, source_ids)
    if assets_changed:
        asset_ids = [entry["id"] if isinstance(entry, dict) else entry for entry in data.get("assets", [])]
    else:
        asset_ids = [item.asset_id for item in existing_materials if item.url is None]
        if any(asset_id is None for asset_id in asset_ids):
            raise ValidationError({"assets": "附件已失效，请显式替换或移除后再保存。"})
    assets = [_asset(user, artifact.workspace, asset_id, artifact) for asset_id in asset_ids]
    links = data.get("links", []) if links_changed else [
        {"title": item.title, "url": item.url, "kind": item.kind}
        for item in existing_materials if item.url is not None
    ]
    for link in links:
        _validate_url(link.get("url"))
    if "cover_asset_id" in data:
        cover = _asset(user, artifact.workspace, data["cover_asset_id"], artifact) if data.get("cover_asset_id") else None
    else:
        cover = artifact.cover_asset
        if artifact.cover_asset_id:
            cover = _asset(user, artifact.workspace, artifact.cover_asset_id, artifact)
    if "category_id" in data:
        category = None
        if data.get("category_id"):
            category = ArtifactCategory.objects.filter(id=data["category_id"], workspace=artifact.workspace, deleted_at__isnull=True).first()
            if category is None:
                raise ValidationError({"category_id": "分类不存在。"})
    else:
        category = artifact.category
    _validate_asset_sources(assets + ([cover] if cover else []), [issue.id for issue in issues])
    action = data.get("primary_action") if "primary_action" in data else artifact.primary_action
    action = action or {"type": "detail", "label": "查看详情"}
    if not isinstance(action, dict) or action.get("type") not in ("detail", "attachment", "link"):
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
    if assignee_ids is not None:
        artifact.assignees.set(assignee_ids)
    if sources_changed:
        artifact.sources.all().delete()
        ArtifactSource.objects.bulk_create([ArtifactSource(artifact=artifact, issue=i, project_id=i.project_id) for i in issues])
    else:
        for issue in issues:
            artifact.sources.filter(issue_id=issue.id).update(project_id=issue.project_id)
    if assets_changed or links_changed:
        material_rows = []
        if assets_changed:
            material_rows.extend(ArtifactMaterial(artifact=artifact, asset=a, title=a.attributes.get("name", "附件"), kind="attachment", position=n) for n, a in enumerate(assets))
        else:
            material_rows.extend(ArtifactMaterial(artifact=artifact, asset=item.asset, title=item.title, kind=item.kind, position=n)
                                 for n, item in enumerate(i for i in existing_materials if i.url is None))
        if links_changed:
            offset = len(material_rows)
            material_rows.extend(ArtifactMaterial(artifact=artifact, title=l["title"], url=l["url"], kind=l.get("kind", "reference"), position=offset+n) for n, l in enumerate(links))
        else:
            offset = len(material_rows)
            material_rows.extend(ArtifactMaterial(artifact=artifact, title=item.title, url=item.url, kind=item.kind, position=offset+n)
                                 for n, item in enumerate(i for i in existing_materials if i.url is not None))
        artifact.materials.all().delete()
        ArtifactMaterial.objects.bulk_create(material_rows)


@transaction.atomic
def create_artifact(user, workspace, data):
    validate_artifact_payload(data, create=True)
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
    validate_artifact_payload(data)
    artifact = Artifact.objects.select_for_update().get(pk=artifact.pk)
    _lock_version(artifact, data.get("version"))
    require_artifact_write(user, artifact)
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
    if getattr(revision, "id", None) is None:
        authorize_existing_sources(user, artifact)
    authorize_snapshot_sources(user, artifact.workspace, revision.snapshot)
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


def published_snapshot(artifact, user, read_context=None):
    if artifact.status != Artifact.Status.PUBLISHED:
        raise NotFound()
    if artifact.access == Artifact.Access.PRIVATE:
        can_edit_artifact = read_context.can_edit(artifact) if read_context else can_edit(user, artifact)
        if not can_edit_artifact:
            raise NotFound()
    revision = artifact.published_revision
    if not revision:
        return None
    snap = dict(revision.snapshot)
    snap["published_version"] = revision.number
    snap["status"] = artifact.status
    category_id = snap.get("category_id")
    if read_context:
        current_category = read_context.categories.get(str(category_id)) if category_id else None
    else:
        current_category = ArtifactCategory.objects.filter(id=category_id, workspace=artifact.workspace, deleted_at__isnull=True).first() if category_id else None
    snap["category"] = current_category.name if current_category else None
    # Report broken references explicitly; a missing private source denies the whole result.
    referenced_assets = [m.get("asset_id") for m in snap.get("materials", []) if m.get("asset_id")]
    if (snap.get("cover") or {}).get("asset_id"):
        referenced_assets.append(snap["cover"]["asset_id"])
    unavailable_assets = 0
    for asset_id in referenced_assets:
        if read_context:
            asset_is_valid = read_context.valid_published_asset(asset_id, artifact)
        else:
            asset = FileAsset.objects.filter(id=asset_id, workspace=artifact.workspace, is_uploaded=True, is_deleted=False, deleted_at__isnull=True).first()
            asset_is_valid = asset is not None and (asset.entity_type != FileAsset.EntityTypeContext.ARTIFACT_ATTACHMENT or str(asset.entity_identifier) == str(artifact.id))
        if not asset_is_valid:
            unavailable_assets += 1
    snap["unavailable_reference_count"] = unavailable_assets
    snap["unavailable_reference_count"] += read_context.authorize_snapshot(snap) if read_context else authorize_snapshot_sources(user, artifact.workspace, snap)
    return snap


@transaction.atomic
def publish_artifact(user, artifact, version):
    artifact = Artifact.objects.select_for_update().get(pk=artifact.pk)
    _lock_version(artifact, version)
    require_artifact_write(user, artifact)
    validated_assignee_ids(artifact.workspace, artifact.assignees.values_list("id", flat=True))
    if artifact.sources.filter(issue__isnull=True).exists():
        raise ValidationError({"source_issue_ids": "存在已删除的来源任务，请先移除该来源。"})
    source_ids = list(artifact.sources.values_list("issue_id", flat=True))
    issues = _source_rows(user, artifact.workspace, source_ids)
    selected_assets = []
    for item in artifact.materials.select_related("asset"):
        if item.asset_id:
            selected_assets.append(_asset(user, artifact.workspace, item.asset_id, artifact))
    if artifact.cover_asset_id:
        selected_assets.append(_asset(user, artifact.workspace, artifact.cover_asset_id, artifact))
    _validate_asset_sources(selected_assets, [issue.id for issue in issues])
    snap = snapshot(artifact, artifact.workspace.slug)
    for link in snap.get("links", []):
        _validate_url(link.get("url"))
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
    require_artifact_write(user, artifact)
    artifact.status = status_value
    artifact.version += 1
    artifact.save(update_fields=["status", "version", "updated_at"])
    return artifact


def serialize_artifact(artifact, user, view="published", read_context=None):
    if read_context is not None:
        editable = read_context.can_edit(artifact)
        draft_snap = snapshot(artifact, artifact.workspace.slug, read_context=read_context) if editable else None
        if view == "draft" and editable:
            read_context.authorize_existing(artifact)
            snap = draft_snap
        else:
            snap = published_snapshot(artifact, user, read_context=read_context)
            if snap is None:
                raise NotFound()
    else:
        draft_snap = snapshot(artifact, artifact.workspace.slug)
        if view == "draft" and can_edit(user, artifact):
            authorize_existing_sources(user, artifact)
            snap = draft_snap
        else:
            snap = published_snapshot(artifact, user)
            if snap is None:
                raise NotFound()
    snap.setdefault("assignee_ids", [])
    if read_context is None:
        editable = can_edit(user, artifact)
    if editable:
        try:
            if read_context is not None:
                read_context.authorize_existing(artifact)
            else:
                authorize_existing_sources(user, artifact)
        except NotFound:
            editable = False
    published = artifact.published_revision.snapshot if artifact.published_revision else None
    compare_keys = ("title", "summary", "category_id", "kind", "source_issue_ids", "assignee_ids", "assets", "links", "primary_action", "cover")
    changed = bool(editable and published and draft_snap and any(draft_snap.get(key, [] if key == "assignee_ids" else None) != published.get(key, [] if key == "assignee_ids" else None) for key in compare_keys))
    snap.update({"owner_id": str(artifact.owner_id) if artifact.owner_id else None, "status": artifact.status, "version": artifact.version,
                 "access": artifact.access,
                 "published_version": artifact.published_revision.number if artifact.published_revision else None,
                 "has_unpublished_changes": changed,
                 "can_edit": editable})
    # Stable GalleryCard projection is shared by the gallery, editor preview, and detail route.
    attachments, links = [], []
    from plane.app.views.attachment_preview import is_previewable_asset
    for item in snap.get("materials", []):
        if item.get("asset_id"):
            base_url = f"/api/workspaces/{artifact.workspace.slug}/artifacts/{artifact.id}/assets/{item['asset_id']}/"
            file_url = base_url + ("draft/" if view == "draft" else "")
            attachments.append({"id": item["asset_id"], "name": item.get("name", item["title"]), "size": item.get("size", 0),
                                "mime": item.get("mime", "application/octet-stream"), "file_url": file_url,
                                "source_url": file_url + "source/", "can_preview": is_previewable_asset(item.get("name", item.get("title", "")), item.get("size", 0))})
        elif item.get("url"):
            links.append({"title": item["title"], "url": item["url"], "kind": item.get("kind", "reference")})
    cover = snap.get("cover")
    if cover:
        cover_url = f"/api/workspaces/{artifact.workspace.slug}/artifacts/{artifact.id}/covers/{cover['asset_id']}/"
        draft_query = "?view=draft" if view == "draft" else ""
        cover.update({"file_url": cover_url + draft_query, "source_url": cover_url + draft_query})
    snap.update({"attachments": attachments, "links": links})
    return snap
