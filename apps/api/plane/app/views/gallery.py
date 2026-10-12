"""Workspace-scoped curated gallery backed by live Plane work items and assets."""

import json
import mimetypes
from pathlib import Path
from urllib.parse import urlparse
from secrets import token_urlsafe

from django.http import FileResponse, HttpResponse, HttpResponseRedirect
from django.shortcuts import get_object_or_404
from django.utils.html import escape
from rest_framework import status
from rest_framework.response import Response

from plane.app.permissions import ROLE, allow_permission
from plane.app.views.attachment_preview import CLOSE_BRIDGE, source_response
from plane.app.views.base import BaseAPIView
from plane.db.models import FileAsset, Issue, IssueLink, ProjectMember, Workspace, WorkspaceMember
from plane.settings.storage import S3Storage


GALLERY_CONFIG = Path(__file__).resolve().parent.parent / "data" / "gallery.json"
IMAGE_EXTENSIONS = frozenset({"png", "gif"})
MAX_PREVIEW_SIZE = 30 * 1024 * 1024
OFFICE_EXTENSIONS = frozenset({"pdf", "doc", "docx", "xls", "xlsx", "ppt", "pptx", "odt", "ods", "odp", "rtf"})


def load_gallery_config():
    with GALLERY_CONFIG.open(encoding="utf-8") as config_file:
        return json.load(config_file)


def _safe_url(value):
    parsed = urlparse(value or "")
    return value if parsed.scheme in {"http", "https"} and parsed.netloc else None


def _asset_extension(asset):
    return str(asset.attributes.get("name", "")).rsplit(".", 1)[-1].lower()


def _asset_file_url(slug, project_id, issue_id, asset):
    if asset.entity_type == FileAsset.EntityTypeContext.ISSUE_ATTACHMENT:
        return asset.asset_url
    return f"/api/workspaces/{slug}/gallery/assets/{project_id}/{issue_id}/{asset.id}/"


def _asset_preview_url(file_url):
    return f"{file_url.rstrip('/')}/preview/onlinePreview"


def _asset_source_url(file_url):
    return f"{file_url.rstrip('/')}/preview/source"


def _curated_asset_map(config):
    assets = {}
    for card in config["cards"]:
        for source_id in card["sources"]:
            for asset in card.get("assets", []):
                # Only expose image assets embedded in descriptions/comments.
                # ISSUE_ATTACHMENT resources keep using Plane's established endpoint.
                if asset["entity_type"] in {
                    FileAsset.EntityTypeContext.ISSUE_DESCRIPTION,
                    FileAsset.EntityTypeContext.COMMENT_DESCRIPTION,
                }:
                    assets[(source_id, asset["id"])] = asset["entity_type"]
    return assets


class WorkspaceGalleryEndpoint(BaseAPIView):
    """Return curated records only when their project is visible to this member."""

    @allow_permission([ROLE.ADMIN, ROLE.MEMBER, ROLE.GUEST], level="WORKSPACE")
    def get(self, request, slug):
        config = load_gallery_config()
        workspace = get_object_or_404(Workspace, slug=slug, id=config["workspace_id"], deleted_at__isnull=True)

        accessible_project_ids = set(
            ProjectMember.objects.filter(
                workspace=workspace,
                member=request.user,
                is_active=True,
                deleted_at__isnull=True,
            ).values_list("project_id", flat=True)
        )
        configured_issue_ids = {issue_id for card in config["cards"] for issue_id in card.get("sources", [])}
        issues = {
            str(issue.id): issue
            for issue in Issue.issue_objects.filter(
                id__in=configured_issue_ids,
                workspace=workspace,
                project_id__in=accessible_project_ids,
                deleted_at__isnull=True,
            ).select_related("project")
        }

        asset_ids = {asset_config["id"] for card in config["cards"] for asset_config in card.get("assets", [])}
        live_assets = {
            str(asset.id): asset
            for asset in FileAsset.objects.filter(
                id__in=asset_ids,
                workspace=workspace,
                project_id__in=accessible_project_ids,
                is_uploaded=True,
                is_deleted=False,
                deleted_at__isnull=True,
            ).select_related("project", "issue", "comment__issue")
        }

        cards = []
        for configured_card in config["cards"]:
            source_issues = [issues.get(source_id) for source_id in configured_card.get("sources", [])]
            source_issues = [issue for issue in source_issues if issue]
            if not source_issues:
                continue

            card_assets = []
            asset_by_id = {}
            for source_issue in source_issues:
                for asset_config in configured_card.get("assets", []):
                    asset = live_assets.get(asset_config["id"])
                    if not asset or asset.entity_type != asset_config["entity_type"]:
                        continue
                    if not _asset_belongs_to_issue(asset, source_issue):
                        continue

                    file_url = _asset_file_url(slug, source_issue.project_id, source_issue.id, asset)
                    can_preview = _is_previewable(asset)
                    asset_name = asset.attributes.get("name", "")
                    attachment = {
                        "id": str(asset.id),
                        "name": asset_name or "附件",
                        "size": int(asset.attributes.get("size", asset.size or 0)),
                        "mime": asset.attributes.get("type")
                        or mimetypes.guess_type(asset_name)[0]
                        or "application/octet-stream",
                        "issue_id": str(source_issue.id),
                        "file_url": file_url,
                        "source_url": _asset_source_url(file_url),
                        "can_preview": can_preview,
                    }
                    card_assets.append(attachment)
                    asset_by_id[str(asset.id)] = attachment

            sources = [
                {
                    "id": str(issue.id),
                    "sequence_id": issue.sequence_id,
                    "name": issue.name,
                    "project_id": str(issue.project_id),
                    "project_name": issue.project.name,
                    "identifier": f"{issue.project.identifier}-{issue.sequence_id}",
                    "url": f"/{slug}/browse/{issue.project.identifier}-{issue.sequence_id}/",
                }
                for issue in source_issues
            ]
            live_source_urls = _issue_source_urls(source_issues)
            links = []
            for configured_link in configured_card.get("links", []):
                url = _safe_url(configured_link.get("url"))
                if url and url in live_source_urls:
                    links.append(
                        {
                            "title": configured_link["title"],
                            "url": url,
                            "kind": configured_link.get("kind", "reference"),
                            "issue_id": str(source_issues[0].id),
                        }
                    )

            cover = None
            cover_asset = asset_by_id.get(configured_card.get("cover_asset_id", ""))
            if cover_asset and (
                cover_asset["can_preview"] or (GALLERY_CONFIG.parent / "covers" / f"{cover_asset['id']}.png").is_file()
            ):
                cover = {
                    "source_url": (
                        f"/api/workspaces/{slug}/gallery/covers/{cover_asset['id']}/"
                        if (GALLERY_CONFIG.parent / "covers" / f"{cover_asset['id']}.png").is_file()
                        else _asset_source_url(cover_asset["file_url"])
                    ),
                    "file_url": cover_asset["file_url"],
                    "name": cover_asset["name"],
                }

            primary = configured_card.get("primary_action", {"type": "detail", "label": "查看详情"})
            if primary.get("type") == "attachment":
                selected_asset = asset_by_id.get(primary.get("attachment_id", ""))
                primary_action = (
                    {"type": "attachment", "label": primary["label"], "attachment_id": selected_asset["id"]}
                    if selected_asset
                    else {"type": "detail", "label": "查看详情"}
                )
            elif primary.get("type") == "link":
                url = _safe_url(primary.get("url"))
                is_verified_link = url and any(link["url"] == url for link in links)
                primary_action = (
                    {"type": "link", "label": primary["label"], "url": url}
                    if is_verified_link
                    else {
                        "type": "detail",
                        "label": "查看详情",
                    }
                )
            else:
                primary_action = {"type": "detail", "label": primary.get("label", "查看详情")}

            cards.append(
                {
                    "id": configured_card["key"],
                    "title": configured_card["title"],
                    "summary": configured_card["summary"],
                    "category": configured_card["category"],
                    "kind": configured_card["kind"],
                    "updated_at": max(issue.updated_at for issue in source_issues).isoformat(),
                    "sources": sources,
                    "attachments": card_assets,
                    "links": links,
                    "cover": cover,
                    "primary_action": primary_action,
                }
            )

        categories = [
            category for category in config["categories"] if any(card["category"] == category for card in cards)
        ]
        cards_with_demo = {
            card["id"]
            for card in cards
            if any(link["kind"] == "demo" for link in card["links"])
            or any(attachment["mime"].startswith("video/") for attachment in card["attachments"])
        }
        return Response(
            {
                "categories": categories,
                "stats": {"total": len(cards), "with_demo": len(cards_with_demo)},
                "cards": cards,
            },
            status=status.HTTP_200_OK,
        )


def _asset_belongs_to_issue(asset, issue):
    if asset.project_id != issue.project_id or asset.workspace_id != issue.workspace_id:
        return False
    if asset.entity_type == FileAsset.EntityTypeContext.ISSUE_ATTACHMENT:
        return asset.issue_id == issue.id
    if asset.entity_type == FileAsset.EntityTypeContext.ISSUE_DESCRIPTION:
        return asset.issue_id == issue.id
    if asset.entity_type == FileAsset.EntityTypeContext.COMMENT_DESCRIPTION:
        return asset.comment is not None and asset.comment.deleted_at is None and asset.comment.issue_id == issue.id
    return False


def _is_previewable(asset):
    extension = _asset_extension(asset)
    supported = extension in {
        "md",
        "markdown",
        "txt",
        "log",
        "csv",
        "json",
        "xml",
        "pdf",
        "doc",
        "docx",
        "xls",
        "xlsx",
        "ppt",
        "pptx",
        "odt",
        "ods",
        "odp",
        "rtf",
        "jpg",
        "jpeg",
        "png",
        "gif",
        "webp",
        "bmp",
        "tif",
        "tiff",
        "mp3",
        "wav",
        "ogg",
        "m4a",
        "aac",
        "flac",
        "mp4",
        "webm",
        "mov",
        "avi",
        "mkv",
    }
    return supported and (extension not in OFFICE_EXTENSIONS or asset.size <= MAX_PREVIEW_SIZE)


def _issue_source_urls(issues):
    issue_ids = [issue.id for issue in issues]
    urls = set(IssueLink.objects.filter(issue_id__in=issue_ids, deleted_at__isnull=True).values_list("url", flat=True))
    for issue in issues:
        urls.update(_anchor_urls(issue.description_html))
    from plane.db.models import IssueComment

    for comment_html in IssueComment.objects.filter(issue_id__in=issue_ids, deleted_at__isnull=True).values_list(
        "comment_html", flat=True
    ):
        urls.update(_anchor_urls(comment_html))
    return {_safe_url(url) for url in urls if _safe_url(url)}


def _anchor_urls(html):
    from html.parser import HTMLParser

    class AnchorURLParser(HTMLParser):
        def __init__(self):
            super().__init__(convert_charrefs=True)
            self.urls = set()

        def handle_starttag(self, tag, attrs):
            if tag.lower() == "a":
                href = dict(attrs).get("href")
                if href:
                    self.urls.add(href.strip())

    parser = AnchorURLParser()
    parser.feed(html or "")
    return parser.urls


class GalleryAssetEndpoint(BaseAPIView):
    """Read-only PNG/GIF preview for explicitly curated issue/comment media."""

    def finalize_response(self, request, response, *args, **kwargs):
        response = super().finalize_response(request, response, *args, **kwargs)
        response["X-Frame-Options"] = "SAMEORIGIN"
        response["Cache-Control"] = "private, no-store"
        response["Referrer-Policy"] = "no-referrer"
        response["X-Content-Type-Options"] = "nosniff"
        return response

    @allow_permission([ROLE.ADMIN, ROLE.MEMBER, ROLE.GUEST])
    def get(self, request, slug, project_id, issue_id, pk, resource=""):
        config = load_gallery_config()
        workspace = get_object_or_404(Workspace, slug=slug, id=config["workspace_id"], deleted_at__isnull=True)
        if not WorkspaceMember.objects.filter(
            workspace=workspace, member=request.user, is_active=True, deleted_at__isnull=True
        ).exists():
            return HttpResponse(status=404)
        allowed_assets = _curated_asset_map(config)
        expected_type = allowed_assets.get((str(issue_id), str(pk)))
        if expected_type not in {
            FileAsset.EntityTypeContext.ISSUE_DESCRIPTION,
            FileAsset.EntityTypeContext.COMMENT_DESCRIPTION,
        }:
            return HttpResponse(status=404)

        issue = get_object_or_404(Issue.issue_objects, id=issue_id, workspace=workspace, project_id=project_id)
        asset = get_object_or_404(
            FileAsset.objects.select_related("comment"),
            id=pk,
            workspace=workspace,
            project_id=project_id,
            is_uploaded=True,
            is_deleted=False,
            deleted_at__isnull=True,
            entity_type=expected_type,
        )
        if not _asset_belongs_to_issue(asset, issue) or _asset_extension(asset) not in IMAGE_EXTENSIONS:
            return HttpResponse(status=404)

        if not resource:
            storage = S3Storage(request=request)
            return HttpResponseRedirect(
                storage.generate_presigned_url(
                    object_name=asset.asset.name,
                    disposition="attachment",
                    filename=asset.attributes.get("name", "image"),
                )
            )
        if resource == "source":
            return source_response(asset, request)
        if resource == "onlinePreview":
            source_url = request.build_absolute_uri(request.path.rsplit("/preview/", 1)[0] + "/preview/source")
            image = (
                f'<img src="{escape(source_url)}" '
                f'alt="{escape(asset.attributes.get("name", "成果图片"))}" '
                'style="max-width:100%;max-height:100vh;object-fit:contain">'
            )
            nonce = token_urlsafe(16)
            close_bridge = CLOSE_BRIDGE.replace("<script>", f'<script nonce="{escape(nonce)}">', 1)
            response = HttpResponse(
                (
                    '<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">'
                    '<meta name="viewport" content="width=device-width,initial-scale=1">'
                    "<title>成果预览</title><style>html,body{margin:0;min-height:100%;"
                    "background:#f5f8fc}body{display:grid;place-items:center}</style></head>"
                    f"<body>{image}{close_bridge}</body></html>"
                ),
                content_type="text/html; charset=utf-8",
            )
            response["Content-Security-Policy"] = (
                f"frame-ancestors 'self'; default-src 'none'; img-src 'self' data:; "
                f"style-src 'unsafe-inline'; script-src 'nonce-{nonce}'"
            )
            return response
        return HttpResponse(status=404)


class GalleryCoverEndpoint(WorkspaceGalleryEndpoint):
    """Derived representative pages; access follows the live source attachment."""

    def get(self, request, slug, pk):
        gallery = super().get(request, slug=slug)
        if gallery.status_code != 200:
            return gallery
        cover_url = f"/api/workspaces/{slug}/gallery/covers/{pk}/"
        if not any(card.get("cover") and card["cover"]["source_url"] == cover_url for card in gallery.data["cards"]):
            return HttpResponse(status=404)
        path = GALLERY_CONFIG.parent / "covers" / f"{pk}.png"
        if not path.is_file():
            return HttpResponse(status=404)
        response = FileResponse(path.open("rb"), content_type="image/png")
        response["Cache-Control"] = "private, no-store"
        response["X-Content-Type-Options"] = "nosniff"
        return response
