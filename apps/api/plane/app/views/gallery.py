"""Published artifact gallery; presentation data is database-backed only."""
from pathlib import Path

from django.http import FileResponse, HttpResponse, HttpResponseRedirect
from django.shortcuts import get_object_or_404
from django.utils.html import escape
from rest_framework.response import Response

from plane.app.services.artifacts import ArtifactReadContext, artifact_read_queryset, can_edit, member_role, render_authorized_asset, serialize_artifact, snapshot
from plane.app.views.base import BaseAPIView
from plane.app.views.attachment_preview import AttachmentPreviewResponseMixin
from plane.app.permissions import ROLE, allow_permission
from rest_framework.exceptions import NotFound, PermissionDenied
from plane.db.models import Artifact, ArtifactRevision, FileAsset, Workspace
from plane.settings.storage import S3Storage


COVER_DIR = Path(__file__).resolve().parent.parent / "data" / "covers"


class WorkspaceGalleryEndpoint(BaseAPIView):
    @allow_permission([ROLE.ADMIN, ROLE.MEMBER, ROLE.GUEST], level="WORKSPACE")
    def get(self, request, slug):
        workspace = get_object_or_404(Workspace, slug=slug, deleted_at__isnull=True)
        rows = list(artifact_read_queryset(Artifact.objects.filter(
            workspace=workspace, status=Artifact.Status.PUBLISHED, deleted_at__isnull=True,
        ).order_by("created_at", "id")))
        read_context = ArtifactReadContext(request.user, workspace, rows)
        cards = []
        for artifact in rows:
            try:
                card = serialize_artifact(artifact, request.user, "published", read_context=read_context)
            except (NotFound, PermissionDenied):
                continue
            card["published_version"] = artifact.published_revision.number if artifact.published_revision else None
            cards.append(card)
        categories = list(dict.fromkeys(c["category"] for c in cards if c.get("category")))
        demos = {c["id"] for c in cards if any(l.get("kind") == "demo" for l in c["links"]) or any(a.get("mime", "").startswith("video/") for a in c["attachments"])}
        return Response({"categories": categories, "stats": {"total": len(cards), "with_demo": len(demos)}, "cards": cards,
                         "can_create": read_context.role in (ROLE.ADMIN.value, ROLE.MEMBER.value)})


class ArtifactAssetEndpoint(AttachmentPreviewResponseMixin, BaseAPIView):
    def get(self, request, slug, pk, asset_id, resource="", view=None):
        workspace = get_object_or_404(Workspace, slug=slug, deleted_at__isnull=True)
        artifact = get_object_or_404(Artifact, id=pk, workspace=workspace, deleted_at__isnull=True)
        if view == "draft" or request.query_params.get("view") == "draft":
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
        artifact = get_object_or_404(Artifact, id=pk, workspace=workspace, deleted_at__isnull=True)
        if request.query_params.get("view") == "draft":
            from rest_framework.exceptions import NotFound
            from types import SimpleNamespace
            if not can_edit(request.user, artifact):
                raise NotFound()
            revision = SimpleNamespace(snapshot=snapshot(artifact, workspace.slug), id=None)
            request.artifact_preview_claim = {"artifact": str(artifact.id), "revision": None, "draft_version": artifact.version,
                                              "user": str(request.user.id)}
        else:
            revision = artifact.published_revision
            if not revision or artifact.status != Artifact.Status.PUBLISHED:
                from rest_framework.exceptions import NotFound
                raise NotFound()
            request.artifact_preview_claim = {"artifact": str(artifact.id), "revision": str(revision.id), "user": str(request.user.id)}
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
