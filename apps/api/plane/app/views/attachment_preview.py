"""Project-authorized attachment preview adapter. Conversion remains upstream."""
import base64
import html as html_utils
import os
import re
import uuid
from pathlib import PurePosixPath
from urllib.parse import quote, unquote

import requests
from django.core import signing
from django.http import HttpResponse, HttpResponseRedirect, StreamingHttpResponse
from django.shortcuts import get_object_or_404
from rest_framework.permissions import AllowAny
from rest_framework.exceptions import NotFound, PermissionDenied
from rest_framework.views import APIView

from plane.app.permissions import ROLE, allow_permission
from plane.app.views.base import BaseAPIView
from plane.db.models import FileAsset, Issue, User
from plane.settings.storage import S3Storage

CLOSE_BRIDGE = """<script>function closeAttachmentPreview(){if(parent!==window)parent.postMessage({type:'bokang:close-attachment-preview'},location.origin)}document.addEventListener('keydown',function(event){if(event.key==='Escape')closeAttachmentPreview()});window.addEventListener('message',function(event){if(event.origin===location.origin&&event.source!==parent&&event.data&&event.data.type==='bokang:close-attachment-preview')closeAttachmentPreview()});</script>"""

SOURCE_SALT = "bokang-attachment-preview-source-v1"
ARTIFACT_SOURCE_SALT = "bokang-artifact-preview-source-v1"
PRESENTATION_SOURCE_SALT = "bokang-presentation-preview-source-v1"
PREVIEW_EXTENSIONS = frozenset("md markdown txt log csv json xml pdf doc docx xls xlsx ppt pptx odt ods odp rtf jpg jpeg png gif webp bmp tif tiff mp3 wav ogg m4a aac flac mp4 webm mov avi mkv".split())
OFFICE_PREVIEW_EXTENSIONS = frozenset("doc docx xls xlsx ppt pptx odt ods odp rtf".split())
STATIC_ROOTS = frozenset("js css bootstrap bootstrap-table pdfjs xlsx excel xspreadsheet pptx highlight images ckplayer".split())


def _valid_uuid_claims(claims, *keys):
    try:
        return all(uuid.UUID(str(claims[key])) for key in keys)
    except (KeyError, TypeError, ValueError, AttributeError):
        return False


def is_previewable_asset(asset_or_name, size=None):
    if isinstance(asset_or_name, str):
        name, size = asset_or_name, size
    else:
        name, size = asset_or_name.attributes.get("name", ""), asset_or_name.size
    extension = name.rsplit(".", 1)[-1].lower()
    return extension in PREVIEW_EXTENSIONS and (extension not in OFFICE_PREVIEW_EXTENSIONS or int(size or 0) <= 30 * 1024 * 1024)


def allowed_preview_path(path, asset_id):
    """Static assets or this attachment's UUID-prefixed output, never another cache."""
    decoded = unquote(unquote(path))
    parts = PurePosixPath(decoded).parts
    if not parts or any(part in (".", "..") for part in decoded.split("/")) or any(c in decoded for c in "\\\\\x00?#") or decoded.startswith("/"):
        return False
    if parts[0] in STATIC_ROOTS or decoded == "favicon.ico":
        return True
    return parts[0].startswith(f"{asset_id.hex}-")


def source_response(asset, request):
    storage = S3Storage()
    kwargs = {"Bucket": storage.aws_storage_bucket_name, "Key": asset.asset.name}
    requested_range = request.headers.get("Range", "")
    if requested_range:
        if not re.fullmatch(r"bytes=(?:\d+-\d*|-\d+)", requested_range):
            return HttpResponse(status=416)
        kwargs["Range"] = requested_range
    try:
        obj = storage.s3_client.get_object(**kwargs)
    except Exception:
        return HttpResponse("附件暂时无法读取，请稍后重试。", status=502)
    body = obj["Body"]
    def chunks():
        try:
            yield from body.iter_chunks(chunk_size=65536)
        finally:
            body.close()
    content_type = asset.attributes.get("type", "application/octet-stream")
    normalized_type = str(content_type).split(";", 1)[0].strip().lower()
    active_content_types = {
        "text/html", "application/xhtml+xml", "image/svg+xml", "application/xml", "text/xml",
        "application/javascript", "text/javascript", "application/ecmascript", "text/ecmascript",
    }
    response = StreamingHttpResponse(chunks(), status=206 if "ContentRange" in obj else 200,
                                     content_type=content_type)
    response["Content-Length"] = str(obj["ContentLength"])
    response["Accept-Ranges"] = "bytes"
    if "ContentRange" in obj:
        response["Content-Range"] = obj["ContentRange"]
    response["Content-Disposition"] = "attachment" if normalized_type in active_content_types else "inline"
    response["Cache-Control"] = "private, no-store"
    # Keep any accidentally active or mislabeled media inert when it is opened
    # directly on the application origin. The conversion service fetches source
    # bytes server-side, so this does not affect image/PDF preview conversion.
    response["Content-Security-Policy"] = "sandbox; default-src 'none';"
    response["X-Content-Type-Options"] = "nosniff"
    return response


class AttachmentPreviewSourceEndpoint(APIView):
    # Short bearer URL is issued only after project authorization, for the
    # conversion service to fetch this exact object (same contract as S3 URLs).
    authentication_classes = []
    permission_classes = [AllowAny]

    def get(self, request, token, filename):
        try:
            claims = signing.loads(token, salt=SOURCE_SALT, max_age=600)
        except signing.BadSignature:
            return HttpResponse(status=403)
        # Require user-bound claims so profile and membership changes revoke
        # already-issued preview links instead of leaving a ten-minute bypass.
        if not isinstance(claims, dict) or not _valid_uuid_claims(claims, "asset", "user", "workspace"):
            return HttpResponse(status=403)
        asset = get_object_or_404(FileAsset, pk=claims["asset"], is_uploaded=True, is_deleted=False,
                                  entity_type=FileAsset.EntityTypeContext.ISSUE_ATTACHMENT)
        user = User.objects.filter(id=claims["user"], is_active=True).first()
        if not user or str(asset.workspace_id) != str(claims.get("workspace")):
            return HttpResponse(status=404)
        try:
            from types import SimpleNamespace
            from plane.db.models import ProjectMember
            from plane.utils.access_policy import get_workspace_access_policy

            policy = get_workspace_access_policy(SimpleNamespace(user=user), asset.workspace.slug)
            policy.require("work_item.detail.read", project_id=asset.project_id)
            project_member = ProjectMember.objects.filter(
                project_id=asset.project_id,
                workspace=asset.workspace,
                member=user,
                is_active=True,
                deleted_at__isnull=True,
                project__deleted_at__isnull=True,
            ).select_related("project").first()
            if not project_member:
                return HttpResponse(status=404)
            if project_member.role == ROLE.GUEST.value and not project_member.project.guest_view_all_features:
                issue = Issue.issue_objects.filter(
                    id=asset.issue_id,
                    workspace=asset.workspace,
                    project_id=asset.project_id,
                    deleted_at__isnull=True,
                ).only("created_by_id").first()
                if issue is None or issue.created_by_id != user.id:
                    return HttpResponse(status=404)
        except PermissionDenied:
            return HttpResponse(status=404)
        if not filename.startswith(f"{asset.id.hex}-"):
            return HttpResponse(status=404)
        return source_response(asset, request)


class ArtifactPreviewSourceEndpoint(APIView):
    """Short-lived conversion URL bound to one user, artifact revision, and asset."""
    authentication_classes = []
    permission_classes = [AllowAny]

    def get(self, request, token, filename):
        from plane.app.services.artifacts import render_authorized_asset
        from plane.db.models import Artifact, User
        try:
            claims = signing.loads(token, salt=ARTIFACT_SOURCE_SALT, max_age=600)
        except signing.BadSignature:
            return HttpResponse(status=403)
        if not isinstance(claims, dict) or not _valid_uuid_claims(claims, "artifact", "user", "asset"):
            return HttpResponse(status=403)
        if claims.get("revision") and not _valid_uuid_claims(claims, "revision"):
            return HttpResponse(status=403)
        artifact = get_object_or_404(Artifact, id=claims.get("artifact"), deleted_at__isnull=True)
        user = User.objects.filter(id=claims.get("user"), is_active=True).first()
        if not user:
            return HttpResponse(status=404)
        try:
            from types import SimpleNamespace
            from plane.utils.access_policy import get_workspace_access_policy

            policy = get_workspace_access_policy(SimpleNamespace(user=user), artifact.workspace.slug)
        except PermissionDenied:
            return HttpResponse(status=404)
        if claims.get("revision"):
            revision = artifact.revisions.filter(id=claims["revision"]).first()
            if revision is None or artifact.status != Artifact.Status.PUBLISHED or str(artifact.published_revision_id) != str(revision.id):
                return HttpResponse(status=404)
            sources = (revision.snapshot or {}).get("sources", [])
            if policy.is_restricted and not sources:
                return HttpResponse(status=404)
            for source in sources:
                issue = Issue.issue_objects.filter(
                    id=source.get("id"), workspace=artifact.workspace, deleted_at__isnull=True
                ).first() if source.get("id") else None
                project_id = issue.project_id if issue else source.get("project_id")
                if policy.is_restricted and not project_id:
                    return HttpResponse(status=404)
                try:
                    policy.require("artifact.published.read", project_id=project_id)
                    policy.require("artifact.material.read", project_id=project_id)
                except PermissionDenied:
                    return HttpResponse(status=404)
        else:
            from types import SimpleNamespace
            if artifact.version != claims.get("draft_version"):
                return HttpResponse(status=404)
            from plane.app.services.artifacts import can_edit
            if policy.is_restricted or not can_edit(user, artifact):
                return HttpResponse(status=404)
            from plane.app.services.artifacts import snapshot
            revision = SimpleNamespace(snapshot=snapshot(artifact, artifact.workspace.slug))
        try:
            asset = render_authorized_asset(user, artifact, revision, claims.get("asset"), policy=policy)
        except (PermissionDenied, NotFound):
            return HttpResponse(status=404)
        if not filename.startswith(f"{asset.id.hex}-"):
            return HttpResponse(status=404)
        return source_response(asset, request)


class PresentationPreviewSourceEndpoint(APIView):
    """Short-lived conversion URL bound to a live presentation view and asset."""
    authentication_classes = []
    permission_classes = [AllowAny]

    def get(self, request, token, filename):
        from plane.app.services.presentations import active_presentation, can_edit
        from plane.db.models import Presentation, User
        try:
            claims = signing.loads(token, salt=PRESENTATION_SOURCE_SALT, max_age=600)
        except signing.BadSignature:
            return HttpResponse(status=403)
        if not isinstance(claims, dict) or not _valid_uuid_claims(claims, "presentation", "user", "asset"):
            return HttpResponse(status=403)
        if claims.get("revision") and not _valid_uuid_claims(claims, "revision"):
            return HttpResponse(status=403)
        presentation = Presentation.objects.filter(id=claims["presentation"], deleted_at__isnull=True).select_related("workspace", "project", "published_revision").first()
        user = User.objects.filter(id=claims["user"], is_active=True).first()
        if presentation is None or user is None:
            return HttpResponse(status=404)
        try:
            from types import SimpleNamespace
            from plane.utils.access_policy import get_workspace_access_policy
            policy = get_workspace_access_policy(SimpleNamespace(user=user), presentation.workspace.slug)
            active_presentation(user, presentation.workspace, presentation.id)
            if claims.get("revision"):
                revision = presentation.published_revision
                if revision is None or str(revision.id) != str(claims["revision"]):
                    return HttpResponse(status=404)
                policy.require("presentation.published.read", project_id=presentation.project_id)
                policy.require("presentation.material.read", project_id=presentation.project_id)
                document = revision.snapshot.get("document", {})
            else:
                if claims.get("draft_version") != presentation.version or not can_edit(user, presentation) or policy.is_restricted:
                    return HttpResponse(status=404)
                document = presentation.document
        except (PermissionDenied, NotFound):
            return HttpResponse(status=404)
        if not filename.startswith(f"{uuid.UUID(claims['asset']).hex}-"):
            return HttpResponse(status=404)
        selected = {str(media.get(key)) for section in document.get("sections", []) for slide in section.get("slides", []) for media in slide.get("media", []) for key in ("asset_id", "preview_asset_id") if media.get(key)}
        preview_sources = {str(media["preview_asset_id"]): str(media["asset_id"]) for section in document.get("sections", []) for slide in section.get("slides", []) for media in slide.get("media", []) if media.get("preview_asset_id")}
        if str(claims["asset"]) not in selected:
            return HttpResponse(status=404)
        asset = FileAsset.objects.filter(id=claims["asset"], workspace=presentation.workspace, project=presentation.project,
                                         is_uploaded=True, is_deleted=False, deleted_at__isnull=True).first()
        if asset is None:
            return HttpResponse(status=404)
        if str(asset.id) in preview_sources:
            from plane.app.services.presentations import presentation_preview_asset_matches
            source_asset = FileAsset.objects.filter(id=preview_sources[str(asset.id)], workspace=presentation.workspace, project=presentation.project,
                                                    is_uploaded=True, is_deleted=False, deleted_at__isnull=True).first()
            if source_asset is None or not presentation_preview_asset_matches(asset, source_asset, presentation):
                return HttpResponse(status=404)
        if asset.entity_type == "PRESENTATION_ATTACHMENT":
            from plane.app.services.presentations import presentation_derived_asset_is_live
            if str(asset.entity_identifier) != str(presentation.id) or not presentation_derived_asset_is_live(asset, presentation):
                return HttpResponse(status=404)
        if asset.entity_type != "PRESENTATION_ATTACHMENT":
            from plane.app.services.presentations import presentation_source_asset_is_live
            if not presentation_source_asset_is_live(asset, presentation.workspace, presentation.project):
                return HttpResponse(status=404)
        from plane.app.services.presentations import can_view_project_media
        if not can_view_project_media(user, presentation, asset, restricted=policy.is_restricted):
            return HttpResponse(status=404)
        return source_response(asset, request)


class AttachmentPreviewResponseMixin:
    def finalize_response(self, request, response, *args, **kwargs):
        response = super().finalize_response(request, response, *args, **kwargs)
        response["X-Frame-Options"] = "SAMEORIGIN"
        policy = response.get("Content-Security-Policy", "")
        if not any(directive.strip().lower().startswith("frame-ancestors ") for directive in policy.split(";")):
            policy = f"{policy.rstrip('; ')}; frame-ancestors 'self'" if policy else "frame-ancestors 'self'"
        response["Content-Security-Policy"] = policy
        response["Cache-Control"] = "private, no-store"
        return response

class AttachmentPreviewEndpoint(AttachmentPreviewResponseMixin, BaseAPIView):
    @allow_permission([ROLE.ADMIN, ROLE.MEMBER, ROLE.GUEST])
    def get(self, request, slug, project_id, issue_id, pk, resource="onlinePreview"):
        asset = get_object_or_404(FileAsset, pk=pk, workspace__slug=slug, project_id=project_id,
                                  issue_id=issue_id, is_uploaded=True, is_deleted=False,
                                  entity_type=FileAsset.EntityTypeContext.ISSUE_ATTACHMENT)
        return preview_authorized_asset(request, asset, resource)

def preview_authorized_asset(request, asset, resource="onlinePreview"):
    if resource == "static/css/loading.gif":
        resource = "css/loading.gif"
    name = asset.attributes.get("name", "附件")
    extension = name.rsplit(".", 1)[-1].lower()
    if extension not in PREVIEW_EXTENSIONS:
        return HttpResponse("此格式暂不支持在线预览，请使用下载按钮。", status=415)
    if extension in OFFICE_PREVIEW_EXTENSIONS and int(asset.size or 0) > 30 * 1024 * 1024:
        return HttpResponse("文件超过在线预览大小限制，请使用下载按钮。", status=413)
    if resource in ("source", "getCorsFile") and extension in PREVIEW_EXTENSIONS:
        return source_response(asset, request)
    if resource != "onlinePreview" and not allowed_preview_path(resource, asset.id):
        return HttpResponse(status=404)
    if resource == "favicon.ico":
        return HttpResponseRedirect("/favicon.ico")
    base_path = request.path[:request.path.rfind("/preview/") + len("/preview/")]
    browser_base = request.build_absolute_uri(base_path)
    preview_claim = getattr(request, "artifact_preview_claim", None)
    browser_source_url = browser_base + "source" + ("?view=draft" if preview_claim and not preview_claim.get("revision") else "")
    if resource == "onlinePreview" and extension in {"mp3", "wav", "ogg", "m4a", "aac", "flac", "mp4", "webm", "mov", "avi", "mkv"}:
        tag = "audio" if extension in {"mp3", "wav", "ogg", "m4a", "aac", "flac"} else "video"
        src = html_utils.escape(browser_source_url, quote=True)
        response = HttpResponse(f"""<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>附件预览 · 泊康项目管理系统</title><link rel="icon" href="/favicon.ico"><style>body{{margin:0;background:#f8fafc;color:#203953;font-family:Arial,sans-serif;display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:100vh}}video{{max-width:100%;max-height:88vh;background:#152c42}}audio{{width:min(90%,620px)}}p{{font-size:14px}}</style></head><body><{tag} controls preload="metadata" src="{src}" onerror="document.getElementById('fallback').hidden=false"></{tag}><p id="fallback" hidden>当前浏览器无法播放此编码，请下载附件查看。</p>{CLOSE_BRIDGE}</body></html>""", content_type="text/html")
        response["Content-Security-Policy"] = "frame-ancestors 'self'"
        response["X-Frame-Options"] = "SAMEORIGIN"
        response["Cache-Control"] = "private, no-store"
        return response
    params = None
    headers = {"X-Base-Url": browser_base, "Accept-Encoding": "identity"}
    if request.headers.get("Range"):
        headers["Range"] = request.headers["Range"]
    if resource == "onlinePreview":
        claim = getattr(request, "artifact_preview_claim", None)
        if claim:
            claim = {**claim, "asset": str(asset.id)}
            if claim.get("presentation"):
                token = signing.dumps(claim, salt=PRESENTATION_SOURCE_SALT, compress=True)
                source_path = "/api/presentation-preview-source/"
            else:
                token = signing.dumps(claim, salt=ARTIFACT_SOURCE_SALT, compress=True)
                source_path = "/api/artifact-preview-source/"
        else:
            token = signing.dumps(
                {
                    "asset": str(asset.id),
                    "user": str(request.user.id),
                    "workspace": str(asset.workspace_id),
                },
                salt=SOURCE_SALT,
                compress=True,
            )
            source_path = "/api/attachment-preview-source/"
        filename = f"{asset.id.hex}-attachment.{extension}"
        # The conversion service must reach this deployment's API instance.
        # Keep the origin server-controlled; request parameters never choose it.
        source_origin = os.environ.get("ATTACHMENT_PREVIEW_SOURCE_URL", "http://api:8000").rstrip("/")
        internal_source = f"{source_origin}{source_path}{token}/{filename}"
        source = internal_source + "?fullfilename=" + quote(filename)
        params = {"url": base64.b64encode(source.encode()).decode()}
        # Only a password supplied by the user is forwarded; caller URLs,
        # cache names and conversion knobs never select the source object.
        if request.query_params.get("filePassword"):
            params["filePassword"] = request.query_params["filePassword"][:256]
    else:
        params = request.query_params.dict()
    upstream = os.environ.get("ATTACHMENT_PREVIEW_URL", "http://file-preview:8012").rstrip("/")
    try:
        result = requests.get(f"{upstream}/{quote(resource, safe='/')}", params=params,
                              headers=headers, stream=True, timeout=(5, 90), allow_redirects=False)
    except requests.RequestException:
        return HttpResponse("预览服务暂时不可用。请稍后重试，或下载附件查看。", status=503)
    if result.status_code >= 400 or 300 <= result.status_code < 400:
        result.close()
        return HttpResponse("附件预览暂时无法生成，请稍后重试或下载查看。", status=502)
    content_type = result.headers.get("Content-Type", "application/octet-stream")
    if "text/html" in content_type:
        html = result.text
        if resource == "onlinePreview":
            html = html.replace(internal_source, browser_source_url)
            html = re.sub(rf"(>\s*){re.escape(filename)}(\s*<)", lambda match: match[1] + html_utils.escape(name) + match[2], html)
        html = html.replace("title:'kkFileView'", "title:'附件预览'")
        html = html.replace("showinfobar: true", "showinfobar: false")
        html = re.sub(r'<label><button onclick="tiaozhuan\(\)">.*?</button></label>', '', html)
        html = re.sub(r'<button id="confirm-button".*?</button>', '', html)
        if "</head>" in html:
            html = html.replace("</head>", """<script>document.addEventListener('webviewerloaded',function(event){event.detail.source.PDFViewerApplicationOptions.set('localeProperties',{lang:'zh-CN'});event.detail.source.PDFViewerApplicationOptions.set('viewerCssTheme',1)});</script></head>""")
        html = re.sub(r"<title>.*?</title>", "<title>附件预览 · 泊康项目管理系统</title>", html, flags=re.S)
        style = "<style>body{background:#f8fafc;color:#203953;font-family:Arial,'Microsoft YaHei',sans-serif} .panel{border-color:#d9e3ef}.panel-heading{background:#edf3f9!important} a{color:#356f9f} .panel-title{font-size:14px} #markdown table{border-collapse:collapse;width:100%;margin:16px 0} #markdown th,#markdown td{border:1px solid #d9e3ef;padding:8px 12px;text-align:left} #markdown th{background:#edf3f9}</style>"
        html = html.replace('"#page=', '"#locale=zh-CN&page=')
        html = html.replace("</head>", style + CLOSE_BRIDGE + "</head>")
        result.close()
        response = HttpResponse(html, content_type=content_type)
    else:
        def chunks():
            try:
                yield from result.iter_content(chunk_size=65536)
            finally:
                result.close()
        response = StreamingHttpResponse(chunks(), status=result.status_code, content_type=content_type)
        for header in ("Content-Length", "Content-Range", "Accept-Ranges"):
            if header in result.headers:
                response[header] = result.headers[header]
    response["Cache-Control"] = "private, no-store"
    response["Referrer-Policy"] = "no-referrer"
    response["X-Content-Type-Options"] = "nosniff"
    response["Content-Security-Policy"] = "frame-ancestors 'self'"
    return response
