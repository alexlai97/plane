"""Authorization and lifecycle for project-bound reveal.js presentations."""
import re
import uuid
from copy import deepcopy
from urllib.parse import urlparse

from django.db import transaction
from django.utils import timezone
from rest_framework.exceptions import APIException, NotFound, PermissionDenied, ValidationError

from plane.app.permissions import ROLE
from plane.db.models import FileAsset, Issue, Presentation, PresentationRevision, ProjectMember, WorkspaceMember


class Conflict(APIException):
    status_code = 409
    default_detail = "演示文稿已被其他人修改，请重新加载后再试。"
    default_code = "version_conflict"


MAX_SECTIONS, MAX_SLIDES, MAX_BODY, MAX_NOTES = 100, 500, 50000, 10000
UUID_RE = re.compile(r"^[0-9a-fA-F-]{36}$")


def member_role(user, workspace):
    return WorkspaceMember.objects.filter(workspace=workspace, member=user, is_active=True, deleted_at__isnull=True).values_list("role", flat=True).first()


def can_project(user, project):
    return ProjectMember.objects.filter(project=project, workspace=project.workspace, member=user, is_active=True, deleted_at__isnull=True, project__deleted_at__isnull=True).exists()


def can_write_project(user, project):
    return ProjectMember.objects.filter(project=project, workspace=project.workspace, member=user, role__gte=15, is_active=True, deleted_at__isnull=True, project__deleted_at__isnull=True).exists()


def can_edit(user, presentation):
    role = member_role(user, presentation.workspace)
    if role == ROLE.ADMIN.value:
        return True
    return role == ROLE.MEMBER.value and can_write_project(user, presentation.project)


def presentation_preview_asset_matches(preview_asset, source_asset, presentation):
    metadata = preview_asset.storage_metadata or {}
    attributes = preview_asset.attributes or {}
    source_id = attributes.get("source_asset_id") or metadata.get("source_asset_id")
    return (
        preview_asset.entity_type == "PRESENTATION_ATTACHMENT"
        and str(preview_asset.entity_identifier) == str(presentation.id)
        and str(source_id) == str(source_asset.id)
        and preview_asset.workspace_id == presentation.workspace_id
        and preview_asset.project_id == presentation.project_id
        and source_asset.workspace_id == presentation.workspace_id
        and source_asset.project_id == presentation.project_id
        and preview_asset.is_uploaded and not preview_asset.is_deleted and preview_asset.deleted_at is None
        and source_asset.is_uploaded and not source_asset.is_deleted and source_asset.deleted_at is None
        and presentation_source_asset_is_live(source_asset, presentation.workspace, presentation.project)
    )


def presentation_derived_asset_is_live(asset, presentation):
    source_id = (asset.attributes or {}).get("source_asset_id") or (asset.storage_metadata or {}).get("source_asset_id")
    source = FileAsset.objects.filter(
        id=source_id, workspace=presentation.workspace, project=presentation.project,
        is_uploaded=True, is_deleted=False, deleted_at__isnull=True,
    ).first()
    return bool(source and presentation_preview_asset_matches(asset, source, presentation))


def presentation_source_asset_is_live(asset, workspace, project):
    """Resolve an asset to a live issue/comment in this project, including rich-text images."""
    from plane.db.models import IssueComment

    if asset.entity_type == "PRESENTATION_ATTACHMENT":
        return False
    if asset.workspace_id != workspace.id or asset.project_id != project.id:
        return False
    source_ids = []
    if asset.issue_id:
        source_ids.append(asset.issue_id)
    if asset.comment_id:
        comment = IssueComment.objects.filter(id=asset.comment_id, deleted_at__isnull=True).select_related("issue").first()
        if comment is None or comment.issue.deleted_at is not None:
            return False
        source_ids.append(comment.issue_id)
    try:
        identifier = uuid.UUID(str(asset.entity_identifier))
    except (TypeError, ValueError, AttributeError):
        identifier = None
    if identifier is not None:
        identifier_issue = Issue.all_objects.filter(id=identifier).first()
        if identifier_issue is not None:
            if identifier_issue.workspace_id != workspace.id or identifier_issue.project_id != project.id or identifier_issue.deleted_at is not None:
                return False
            source_ids.append(identifier_issue.id)
        else:
            identifier_comment = IssueComment.objects.filter(id=identifier, deleted_at__isnull=True).select_related("issue").first()
            if identifier_comment is not None:
                if identifier_comment.issue.workspace_id != workspace.id or identifier_comment.issue.project_id != project.id or identifier_comment.issue.deleted_at is not None:
                    return False
                source_ids.append(identifier_comment.issue_id)
    if source_ids:
        return all(Issue.objects.filter(id=issue_id, workspace=workspace, project=project, deleted_at__isnull=True).exists() for issue_id in source_ids)

    # Some historical image-component assets carry neither FK. Recover their
    # actual owner only from a live same-project rich-text reference.
    asset_id = re.escape(str(asset.id))
    marker = re.compile(
        rf"<image-component\b(?=[^>]*(?:\bid\s*=\s*['\"]{asset_id}['\"]|\bsrc\s*=\s*['\"][^'\"]*{asset_id}[^'\"]*['\"]))[^>]*>",
        re.IGNORECASE,
    )
    issue_html = Issue.objects.filter(workspace=workspace, project=project, deleted_at__isnull=True).values_list("description_html", flat=True)
    if any(marker.search(value or "") for value in issue_html):
        return True
    comment_html = IssueComment.objects.filter(issue__workspace=workspace, issue__project=project,
                                                issue__deleted_at__isnull=True, deleted_at__isnull=True).values_list("comment_html", flat=True)
    return any(marker.search(value or "") for value in comment_html)


def can_view_project_media(user, presentation, asset, restricted=False):
    membership = ProjectMember.objects.filter(
        project=presentation.project, workspace=presentation.workspace, member=user,
        is_active=True, deleted_at__isnull=True, project__deleted_at__isnull=True,
    ).exists()
    # Published presentations are an explicit, project-scoped curation surface.
    # This does not grant direct access to the source issue or attachment routes.
    return membership


def active_presentation(user, workspace, pk, write=False):
    obj = Presentation.objects.select_related("project", "published_revision").filter(id=pk, workspace=workspace, project__workspace=workspace, project__deleted_at__isnull=True, deleted_at__isnull=True).first()
    if not obj:
        raise NotFound()
    if member_role(user, workspace) is None:
        raise NotFound()
    if member_role(user, workspace) != ROLE.ADMIN.value and not can_project(user, obj.project):
        raise NotFound()
    if write and not can_edit(user, obj):
        raise PermissionDenied()
    return obj


def _uuid(value, field):
    try:
        return uuid.UUID(str(value))
    except (TypeError, ValueError, AttributeError):
        raise ValidationError({field: "必须是有效 UUID。"})


def validate_document(user, workspace, project, document, presentation_id=None):
    if not isinstance(document, dict) or set(document) != {"schema_version", "sections"} or document.get("schema_version") != 1 or not isinstance(document.get("sections"), list) or len(document["sections"]) > MAX_SECTIONS:
        raise ValidationError({"document": "文档必须符合 schema_version 1 的 sections 结构。"})
    ids, slide_count = set(), 0
    referenced_issues, referenced_assets = set(), set()
    preview_relationships = []
    def check_id(value, path):
        identifier = str(_uuid(value, path))
        if identifier in ids:
            raise ValidationError({"document": "section 和 slide 的 id 必须唯一。"})
        ids.add(identifier)
    for section in document["sections"]:
        if not isinstance(section, dict) or set(section) - {"id", "title", "slides"} or not isinstance(section.get("title"), str) or len(section["title"]) > 255 or not isinstance(section.get("slides"), list):
            raise ValidationError({"document": "每个 section 必须包含 id、title 和 slides。"})
        check_id(section.get("id"), "section.id")
        for slide in section["slides"]:
            slide_count += 1
            if slide_count > MAX_SLIDES or not isinstance(slide, dict) or set(slide) - {"id", "title", "body", "notes", "issue_ids", "media", "links"}:
                raise ValidationError({"document": "slide 数量过多或包含不支持的字段。"})
            if not isinstance(slide.get("title"), str) or len(slide["title"]) > 255 or not isinstance(slide.get("body"), str) or len(slide["body"]) > MAX_BODY or not isinstance(slide.get("notes", ""), str) or len(slide.get("notes", "")) > MAX_NOTES:
                raise ValidationError({"document": "slide title/body/notes 格式或长度无效。"})
            if re.search(r"(?is)<\s*(?:script|iframe|object|embed|style|html|body)\b|<\s*/?\s*[a-z][^>]*>", slide.get("body", "") + slide.get("notes", "")):
                raise ValidationError({"document": "Markdown 内容不得包含 HTML 标签或脚本。"})
            check_id(slide.get("id"), "slide.id")
            if not isinstance(slide.get("issue_ids", []), list) or not isinstance(slide.get("media", []), list) or not isinstance(slide.get("links", []), list):
                raise ValidationError({"document": "issue_ids、media 和 links 必须是数组。"})
            referenced_issues.update(str(_uuid(v, "issue_ids")) for v in slide.get("issue_ids", []))
            for media in slide.get("media", []):
                if not isinstance(media, dict) or set(media) - {"asset_id", "preview_asset_id", "caption", "file_url", "preview_url", "preview_file_url", "filename", "mime_type", "can_preview"} or not isinstance(media.get("caption", ""), str):
                    raise ValidationError({"document": "media 必须包含 asset_id、可选 preview_asset_id 和 caption。"})
                referenced_assets.add(str(_uuid(media.get("asset_id"), "media.asset_id")))
                if media.get("preview_asset_id"):
                    preview_id = str(_uuid(media["preview_asset_id"], "media.preview_asset_id"))
                    referenced_assets.add(preview_id)
                    preview_relationships.append((preview_id, str(media["asset_id"])))
            for link in slide.get("links", []):
                if not isinstance(link, dict) or set(link) != {"label", "url"} or not isinstance(link.get("label"), str) or len(link["label"]) > 255:
                    raise ValidationError({"document": "link 必须包含 label 和 url。"})
                parsed = urlparse(link["url"] if isinstance(link["url"], str) else "")
                if parsed.scheme not in ("http", "https") or not parsed.hostname or parsed.username or parsed.password:
                    raise ValidationError({"document": "链接必须是安全的 http 或 https 地址。"})
    for issue in Issue.objects.filter(id__in=referenced_issues, workspace=workspace, project=project, deleted_at__isnull=True):
        if member_role(user, workspace) != ROLE.ADMIN.value and not can_project(user, project):
            raise PermissionDenied()
    if len(referenced_issues) != Issue.objects.filter(id__in=referenced_issues, workspace=workspace, project=project, deleted_at__isnull=True).count():
        raise ValidationError({"document": "存在已删除或不属于当前项目的 issue 引用。"})
    asset_records = {}
    for aid in referenced_assets:
        asset = FileAsset.objects.filter(id=aid, workspace=workspace, project=project, is_uploaded=True, is_deleted=False, deleted_at__isnull=True).select_related("issue", "comment").first()
        if asset is None:
            raise ValidationError({"document": "存在不可用或不属于当前项目的文件引用。"})
        if asset.entity_type == "PRESENTATION_ATTACHMENT":
            if presentation_id is None or str(asset.entity_identifier) != str(presentation_id):
                raise ValidationError({"document": "演示文稿衍生文件必须属于当前演示文稿。"})
            presentation = Presentation.objects.filter(id=presentation_id, workspace=workspace, project=project, deleted_at__isnull=True).first()
            if presentation is None or not presentation_derived_asset_is_live(asset, presentation):
                raise ValidationError({"document": "演示文稿衍生文件必须保留可用的 source_asset_id。"})
        elif not presentation_source_asset_is_live(asset, workspace, project):
            raise ValidationError({"document": "文件没有有效的同项目 issue/comment 来源。"})
        asset_records[aid] = asset
    if preview_relationships:
        if presentation_id is None:
            raise ValidationError({"document": "页面衍生预览只能在演示文稿创建后关联。"})
        presentation = Presentation.objects.filter(id=presentation_id, workspace=workspace, project=project, deleted_at__isnull=True).first()
        if presentation is None:
            raise ValidationError({"document": "演示文稿不存在或已删除。"})
        for preview_id, source_id in preview_relationships:
            if not presentation_preview_asset_matches(asset_records[preview_id], asset_records[source_id], presentation):
                raise ValidationError({"document": "派生预览必须保留当前演示文稿和来源文件的 source_asset_id 关联。"})
    # URLs and filename/preview flags are response-only convenience fields.
    clean = deepcopy(document)
    for section in clean["sections"]:
        for slide in section["slides"]:
            for media in slide.get("media", []):
                for key in ("file_url", "preview_url", "preview_file_url", "filename", "mime_type", "can_preview"):
                    media.pop(key, None)
    return clean


def require_version(obj, version):
    try:
        value = int(version)
    except (TypeError, ValueError):
        raise ValidationError({"version": "必须提供当前版本号。"})
    if value != obj.version:
        raise Conflict()


@transaction.atomic
def create_presentation(user, workspace, data):
    project_id = _uuid(data.get("project_id"), "project_id")
    from plane.db.models import Project
    project = Project.objects.filter(id=project_id, workspace=workspace, deleted_at__isnull=True).first()
    if not project:
        raise ValidationError({"project_id": "项目不存在或不属于当前工作区。"})
    role = member_role(user, workspace)
    if role == ROLE.ADMIN.value:
        pass
    elif role != ROLE.MEMBER.value or not can_write_project(user, project):
        raise PermissionDenied()
    title, document = data.get("title"), data.get("document")
    if not isinstance(title, str) or not title.strip() or len(title) > 255:
        raise ValidationError({"title": "标题必填且不得超过 255 字符。"})
    document = validate_document(user, workspace, project, document)
    return Presentation.objects.create(workspace=workspace, project=project, owner=user, title=title.strip(), document=document)


@transaction.atomic
def update_presentation(user, obj, data):
    obj = Presentation.objects.select_for_update().select_related("workspace", "project").filter(
        pk=obj.pk, deleted_at__isnull=True, workspace__deleted_at__isnull=True, project__deleted_at__isnull=True,
    ).first()
    if obj is None:
        raise NotFound()
    if not can_edit(user, obj):
        raise PermissionDenied()
    require_version(obj, data.get("version"))
    if "title" in data:
        if not isinstance(data["title"], str) or not data["title"].strip() or len(data["title"]) > 255:
            raise ValidationError({"title": "标题必填且不得超过 255 字符。"})
        obj.title = data["title"].strip()
    if "document" in data:
        obj.document = validate_document(user, obj.workspace, obj.project, data["document"], obj.id)
    if not (set(data) & {"title", "document"}):
        raise ValidationError({"detail": "必须提供 title 或 document。"})
    obj.version += 1
    obj.save(update_fields=["title", "document", "version", "updated_at"])
    return obj


@transaction.atomic
def publish_presentation(user, obj, version):
    obj = Presentation.objects.select_for_update().select_related("workspace", "project").filter(
        pk=obj.pk, deleted_at__isnull=True, workspace__deleted_at__isnull=True, project__deleted_at__isnull=True,
    ).first()
    if obj is None:
        raise NotFound()
    if not can_edit(user, obj):
        raise PermissionDenied()
    require_version(obj, version)
    validate_document(user, obj.workspace, obj.project, obj.document, obj.id)
    number = obj.revisions.count() + 1
    revision = PresentationRevision.objects.create(presentation=obj, number=number, snapshot={"title": obj.title, "document": obj.document}, actor=user)
    obj.published_revision = revision
    obj.version += 1
    obj.save(update_fields=["published_revision", "version", "updated_at"])
    return obj


def serialize_presentation(obj, user, policy, view="published", detail=False):
    editable = can_edit(user, obj) and not policy.is_restricted
    policy.require("presentation.published.read", project_id=obj.project_id)
    revision = obj.published_revision
    if revision is None and not editable:
        raise NotFound()
    draft_view = view == "draft" and editable
    source = {"title": obj.title, "document": obj.document} if draft_view or revision is None else revision.snapshot
    result = {"id": str(obj.id), "title": source["title"], "project_id": str(obj.project_id), "version": obj.version,
              "published_revision_id": str(revision.id) if revision else None,
              "has_unpublished_changes": bool(revision and (revision.snapshot.get("title") != obj.title or revision.snapshot.get("document") != obj.document)),
              "can_edit": bool(editable), "created_at": obj.created_at, "updated_at": obj.updated_at}
    if detail:
        doc = deepcopy(source["document"])
        from plane.app.services.work_item_references import resolve_work_item_references
        referenced_ids = list(dict.fromkeys(
            value for section in doc.get("sections", []) for slide in section.get("slides", [])
            for value in slide.get("issue_ids", [])
        ))
        result["sources"] = list(resolve_work_item_references(user, obj.workspace, referenced_ids, obj.project_id).values()) if policy.allows("work_item.detail.read") else []
        from plane.app.views.attachment_preview import is_previewable_asset
        for section in doc.get("sections", []):
            for slide in section.get("slides", []):
                if not editable:
                    slide["notes"] = ""
                for media in slide.get("media", []):
                    base = f"/api/workspaces/{obj.workspace.slug}/presentations/{obj.id}/assets/{media['asset_id']}/"
                    media["file_url"] = base + ("?view=draft" if draft_view else "")
                    media["preview_url"] = base + "preview/onlinePreview" + ("?view=draft" if draft_view else "")
                    asset = FileAsset.objects.filter(id=media["asset_id"], workspace=obj.workspace, project=obj.project, is_uploaded=True, is_deleted=False, deleted_at__isnull=True).first()
                    media["filename"] = asset.attributes.get("name", "附件") if asset else "附件"
                    media["mime_type"] = str((asset.attributes.get("type", "application/octet-stream") if asset else "application/octet-stream")).split(";", 1)[0].strip().lower()
                    media["can_preview"] = is_previewable_asset(media["filename"], asset.size if asset else 0)
                    if media.get("preview_asset_id"):
                        media["preview_file_url"] = f"/api/workspaces/{obj.workspace.slug}/presentations/{obj.id}/assets/{media['preview_asset_id']}/" + ("?view=draft" if draft_view else "")
        result["document"] = doc
    return result
