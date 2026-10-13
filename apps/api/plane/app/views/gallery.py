"""Published artifact gallery; presentation data is database-backed only."""
from pathlib import Path

from django.http import FileResponse, HttpResponse, HttpResponseRedirect
from django.shortcuts import get_object_or_404
from django.utils.html import escape
from rest_framework.response import Response

from plane.app.services.artifacts import can_edit, published_snapshot, render_authorized_asset, snapshot
from plane.app.views.base import BaseAPIView
from plane.app.permissions import ROLE, allow_permission
from rest_framework.exceptions import NotFound, PermissionDenied
from plane.db.models import Artifact, ArtifactRevision, FileAsset, Workspace
from plane.settings.storage import S3Storage


COVER_DIR = Path(__file__).resolve().parent.parent / "data" / "covers"


class WorkspaceGalleryEndpoint(BaseAPIView):
    @allow_permission([ROLE.ADMIN, ROLE.MEMBER, ROLE.GUEST], level="WORKSPACE")
    def get(self, request, slug):
        workspace = get_object_or_404(Workspace, slug=slug, deleted_at__isnull=True)
        rows = Artifact.objects.filter(workspace=workspace, status=Artifact.Status.PUBLISHED,
                                       deleted_at__isnull=True).select_related("published_revision")
        cards = []
        for artifact in rows:
            try:
                snap = published_snapshot(artifact, request.user)
            except (NotFound, PermissionDenied):
                continue
            attachments, links = [], []
            for material in snap.get("materials", []):
                if material.get("asset_id"):
                    asset_id = material["asset_id"]
                    file_url = f"/api/workspaces/{slug}/artifacts/{artifact.id}/assets/{asset_id}/"
                    attachments.append({"id": asset_id, "name": material.get("name", material["title"]), "size": material.get("size", 0), "mime": material.get("mime", "application/octet-stream"), "file_url": file_url, "source_url": file_url + "source/", "can_preview": True})
                elif material.get("url"):
                    links.append({"title": material["title"], "url": material["url"], "kind": material.get("kind", "reference")})
            cover = snap.get("cover")
            if cover:
                cover_url = f"/api/workspaces/{slug}/artifacts/{artifact.id}/covers/{cover['asset_id']}/"
                cover["file_url"] = cover_url
                cover["source_url"] = cover_url
            draft = snapshot(artifact, slug)
            compare_keys = ("title", "summary", "category_id", "kind", "source_issue_ids", "assets", "links", "primary_action", "cover")
            editable = can_edit(request.user, artifact)
            changed = bool(editable and any(draft.get(key) != snap.get(key) for key in compare_keys))
            cards.append({"id": snap["id"], "title": snap["title"], "summary": snap["summary"], "category": snap.get("category"),
                          "kind": snap["kind"], "updated_at": snap.get("updated_at"), "sources": snap.get("sources", []),
                          "attachments": attachments, "links": links, "cover": cover,
                          "primary_action": snap.get("primary_action", {"type": "detail", "label": "查看详情"}),
                          "category_id": snap.get("category_id"), "owner_id": str(artifact.owner_id), "status": artifact.status,
                          "version": artifact.version, "published_version": artifact.published_revision.number if artifact.published_revision else None,
                          "has_unpublished_changes": changed, "unavailable_reference_count": snap.get("unavailable_reference_count", 0), "can_edit": editable})
        categories = list(dict.fromkeys(c["category"] for c in cards if c.get("category")))
        demos = {c["id"] for c in cards if any(l.get("kind") == "demo" for l in c["links"]) or any(a.get("mime", "").startswith("video/") for a in c["attachments"])}
        return Response({"categories": categories, "stats": {"total": len(cards), "with_demo": len(demos)}, "cards": cards})


class ArtifactAssetEndpoint(BaseAPIView):
    def get(self, request, slug, pk, asset_id, resource=""):
        workspace = get_object_or_404(Workspace, slug=slug, deleted_at__isnull=True)
        artifact = get_object_or_404(Artifact, id=pk, workspace=workspace, deleted_at__isnull=True)
        if request.query_params.get("view") == "draft":
            from rest_framework.exceptions import NotFound
            if not can_edit(request.user, artifact):
                raise NotFound()
            from types import SimpleNamespace
            revision = SimpleNamespace(snapshot=snapshot(artifact, slug), id=None)
            request.artifact_preview_claim = {"artifact": str(artifact.id), "revision": None, "draft_version": artifact.version,
                                              "user": str(request.user.id)}
        else:
            revision = artifact.published_revision
            if not revision or artifact.status != Artifact.Status.PUBLISHED:
                from rest_framework.exceptions import NotFound
                raise NotFound()
            request.artifact_preview_claim = {"artifact": str(artifact.id), "revision": str(revision.id), "user": str(request.user.id)}
        asset = render_authorized_asset(request.user, artifact, revision, asset_id)
        if not resource:
            storage = S3Storage(request=request)
            return HttpResponseRedirect(storage.generate_presigned_url(object_name=asset.asset.name, disposition="attachment", filename=asset.attributes.get("name", "attachment")))
        if resource == "source":
            from plane.app.views.attachment_preview import source_response
            return source_response(asset, request)
        from plane.app.views.attachment_preview import preview_authorized_asset
        return preview_authorized_asset(request, asset, resource)


class ArtifactCoverEndpoint(ArtifactAssetEndpoint):
    def get(self, request, slug, pk, asset_id):
        from django.http import FileResponse
        workspace = get_object_or_404(Workspace, slug=slug, deleted_at__isnull=True)
        artifact = get_object_or_404(Artifact, id=pk, workspace=workspace, status=Artifact.Status.PUBLISHED, deleted_at__isnull=True)
        revision = artifact.published_revision
        if not revision:
            from rest_framework.exceptions import NotFound
            raise NotFound()
        render_authorized_asset(request.user, artifact, revision, asset_id)
        path = COVER_DIR / f"{asset_id}.png"
        if path.is_file():
            response = FileResponse(path.open("rb"), content_type="image/png")
            response["Cache-Control"] = "private, no-store"
            response["X-Content-Type-Options"] = "nosniff"
            return response
        return super().get(request, slug, pk, asset_id, "source")


class GalleryAssetEndpoint(ArtifactAssetEndpoint):
    def get(self, request, slug, project_id=None, issue_id=None, pk=None, resource=""):
        # Compatibility route is intentionally closed unless the same live artifact authorization applies.
        from rest_framework.exceptions import NotFound
        raise NotFound()


class GalleryCoverEndpoint(ArtifactAssetEndpoint):
    def get(self, request, slug, pk):
        from rest_framework.exceptions import NotFound
        raise NotFound()
