"""Project-authorized attachment preview adapter. Conversion remains upstream."""
import base64
import html as html_utils
import os
import re
from pathlib import PurePosixPath
from urllib.parse import quote, unquote

import requests
from django.core import signing
from django.http import HttpResponse, HttpResponseRedirect, StreamingHttpResponse
from django.shortcuts import get_object_or_404
from rest_framework.permissions import AllowAny
from rest_framework.views import APIView

from plane.app.permissions import ROLE, allow_permission
from plane.app.views.base import BaseAPIView
from plane.db.models import FileAsset
from plane.settings.storage import S3Storage

CLOSE_BRIDGE = """<script>function closeAttachmentPreview(){if(parent!==window)parent.postMessage({type:'bokang:close-attachment-preview'},location.origin)}document.addEventListener('keydown',function(event){if(event.key==='Escape')closeAttachmentPreview()});window.addEventListener('message',function(event){if(event.origin===location.origin&&event.source!==parent&&event.data&&event.data.type==='bokang:close-attachment-preview')closeAttachmentPreview()});</script>"""

SOURCE_SALT = "bokang-attachment-preview-source-v1"
PREVIEW_EXTENSIONS = frozenset("md markdown txt log csv json xml pdf doc docx xls xlsx ppt pptx odt ods odp rtf jpg jpeg png gif webp bmp tif tiff mp3 wav ogg m4a aac flac mp4 webm mov avi mkv".split())
STATIC_ROOTS = frozenset("js css bootstrap bootstrap-table pdfjs xlsx excel xspreadsheet pptx highlight images ckplayer".split())


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
    response = StreamingHttpResponse(chunks(), status=206 if "ContentRange" in obj else 200,
                                     content_type=asset.attributes.get("type", "application/octet-stream"))
    response["Content-Length"] = str(obj["ContentLength"])
    response["Accept-Ranges"] = "bytes"
    if "ContentRange" in obj:
        response["Content-Range"] = obj["ContentRange"]
    response["Content-Disposition"] = "attachment" if asset.attributes.get("type") in ("text/html", "image/svg+xml", "application/xml", "text/xml") else "inline"
    response["Cache-Control"] = "private, no-store"
    response["X-Content-Type-Options"] = "nosniff"
    return response


class AttachmentPreviewSourceEndpoint(APIView):
    # Short bearer URL is issued only after project authorization, for the
    # conversion service to fetch this exact object (same contract as S3 URLs).
    authentication_classes = []
    permission_classes = [AllowAny]

    def get(self, request, token, filename):
        try:
            asset_id = signing.loads(token, salt=SOURCE_SALT, max_age=600)
        except signing.BadSignature:
            return HttpResponse(status=403)
        asset = get_object_or_404(FileAsset, pk=asset_id, is_uploaded=True, is_deleted=False,
                                  entity_type=FileAsset.EntityTypeContext.ISSUE_ATTACHMENT)
        if not filename.startswith(f"{asset.id.hex}-"):
            return HttpResponse(status=404)
        return source_response(asset, request)


class AttachmentPreviewEndpoint(BaseAPIView):
    def finalize_response(self, request, response, *args, **kwargs):
        response = super().finalize_response(request, response, *args, **kwargs)
        response["X-Frame-Options"] = "SAMEORIGIN"
        response["Content-Security-Policy"] = "frame-ancestors 'self'"
        response["Cache-Control"] = "private, no-store"
        return response

    @allow_permission([ROLE.ADMIN, ROLE.MEMBER, ROLE.GUEST])
    def get(self, request, slug, project_id, issue_id, pk, resource="onlinePreview"):
        asset = get_object_or_404(FileAsset, pk=pk, workspace__slug=slug, project_id=project_id,
                                  issue_id=issue_id, is_uploaded=True, is_deleted=False,
                                  entity_type=FileAsset.EntityTypeContext.ISSUE_ATTACHMENT)
        if resource == "static/css/loading.gif":
            resource = "css/loading.gif"
        name = asset.attributes.get("name", "附件")
        extension = name.rsplit(".", 1)[-1].lower()
        if resource in ("source", "getCorsFile") and extension in PREVIEW_EXTENSIONS:
            return source_response(asset, request)
        if extension not in PREVIEW_EXTENSIONS:
            return HttpResponse("此格式暂不支持在线预览，请使用下载按钮。", status=415)
        if resource != "onlinePreview" and not allowed_preview_path(resource, asset.id):
            return HttpResponse(status=404)
        if resource == "favicon.ico":
            return HttpResponseRedirect("/favicon.ico")
        base_path = request.path[:request.path.rfind("/preview/") + len("/preview/")]
        browser_base = request.build_absolute_uri(base_path)
        if resource == "onlinePreview" and extension in {"mp3", "wav", "ogg", "m4a", "aac", "flac", "mp4", "webm", "mov", "avi", "mkv"}:
            tag = "audio" if extension in {"mp3", "wav", "ogg", "m4a", "aac", "flac"} else "video"
            src = html_utils.escape(browser_base + "source", quote=True)
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
            token = signing.dumps(str(asset.id), salt=SOURCE_SALT, compress=True)
            filename = f"{asset.id.hex}-attachment.{extension}"
            internal_source = f"http://api:8000/api/attachment-preview-source/{token}/{filename}"
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
                html = html.replace(internal_source, browser_base + "source")
                html = re.sub(rf"(>\s*){re.escape(filename)}(\s*<)", lambda match: match[1] + html_utils.escape(name) + match[2], html)
            html = html.replace("title:'kkFileView'", "title:'附件预览'")
            html = html.replace("showinfobar: true", "showinfobar: false")
            html = re.sub(r'<label><button onclick="tiaozhuan\(\)">.*?</button></label>', '', html)
            html = re.sub(r'<button id="confirm-button".*?</button>', '', html)
            if "</head>" in html:
                html = html.replace("</head>", """<script>document.addEventListener('webviewerloaded',function(event){event.detail.source.PDFViewerApplicationOptions.set('localeProperties',{lang:'zh-CN'});event.detail.source.PDFViewerApplicationOptions.set('viewerCssTheme',1)});</script></head>""")
            html = re.sub(r"<title>.*?</title>", "<title>附件预览 · 泊康项目管理系统</title>", html, flags=re.S)
            style = "<style>body{background:#f8fafc;color:#203953;font-family:Arial,'Microsoft YaHei',sans-serif} .panel{border-color:#d9e3ef}.panel-heading{background:#edf3f9!important} a{color:#356f9f} .panel-title{font-size:14px}</style>"
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
