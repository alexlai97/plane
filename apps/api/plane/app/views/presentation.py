from django.shortcuts import get_object_or_404
from django.db import transaction
from django.utils import timezone
from rest_framework import status
from rest_framework.exceptions import NotFound, PermissionDenied
from rest_framework.response import Response

from plane.app.services.presentations import (
    active_presentation, can_edit, create_presentation, member_role, publish_presentation,
    serialize_presentation, update_presentation,
)
from plane.app.views.base import BaseAPIView
from plane.app.views.attachment_preview import AttachmentPreviewResponseMixin, preview_authorized_asset, source_response
from plane.db.models import FileAsset, Presentation, Workspace
from plane.app.permissions import ROLE
from plane.api.middleware.api_authentication import APIKeyAuthentication
from plane.api.rate_limit import ApiKeyRateThrottle


class PresentationEndpoint(BaseAPIView):
    access_policy_capabilities = {"GET": "presentation.published.read", "HEAD": "presentation.published.read", "OPTIONS": "presentation.published.read"}

    def context(self, request, slug):
        workspace = get_object_or_404(Workspace, slug=slug, deleted_at__isnull=True)
        role = member_role(request.user, workspace)
        if role is None:
            raise NotFound()
        from plane.utils.access_policy import get_workspace_access_policy
        return workspace, role, get_workspace_access_policy(request, slug)

    def get(self, request, slug, pk=None):
        workspace, role, policy = self.context(request, slug)
        view = request.query_params.get("view", "published")
        if view not in ("draft", "published"):
            from rest_framework.exceptions import ValidationError
            raise ValidationError({"view": "仅支持 draft 或 published。"})
        if pk:
            obj = active_presentation(request.user, workspace, pk)
            if view == "draft" and (policy.is_restricted or not can_edit(request.user, obj)):
                raise NotFound()
            return Response(serialize_presentation(obj, request.user, policy, view, detail=True))
        # Project membership is needed for ordinary workspace members. Restricted profiles
        # are additionally constrained by their explicit project grants in the policy.
        rows = Presentation.objects.filter(workspace=workspace, project__workspace=workspace, project__deleted_at__isnull=True, deleted_at__isnull=True).select_related("project", "published_revision").order_by("updated_at", "id")
        if policy.is_restricted:
            rows = rows.filter(published_revision__isnull=False, project_id__in=policy.allowed_project_ids or ())
        elif role != ROLE.ADMIN.value:
            from plane.db.models import ProjectMember
            project_ids = ProjectMember.objects.filter(workspace=workspace, member=request.user, is_active=True, deleted_at__isnull=True).values_list("project_id", flat=True)
            rows = rows.filter(project_id__in=project_ids)
        results = []
        for obj in rows:
            try:
                results.append(serialize_presentation(obj, request.user, policy, view, detail=False))
            except (NotFound, PermissionDenied):
                continue
        return Response({"results": results, "count": len(results), "can_create": not policy.is_restricted and role in (ROLE.ADMIN.value, ROLE.MEMBER.value)})

    def post(self, request, slug, pk=None, action=None, **kwargs):
        workspace, role, policy = self.context(request, slug)
        if policy.is_restricted:
            raise NotFound()
        if action == "publish":
            obj = active_presentation(request.user, workspace, pk, write=True)
            obj = publish_presentation(request.user, obj, request.data.get("version"))
            return Response(serialize_presentation(obj, request.user, policy, "published", detail=True))
        obj = create_presentation(request.user, workspace, request.data)
        return Response(serialize_presentation(obj, request.user, policy, "draft", detail=True), status=status.HTTP_201_CREATED)

    def patch(self, request, slug, pk):
        workspace, _, policy = self.context(request, slug)
        if policy.is_restricted:
            raise NotFound()
        obj = active_presentation(request.user, workspace, pk, write=True)
        obj = update_presentation(request.user, obj, request.data)
        return Response(serialize_presentation(obj, request.user, policy, "draft", detail=True))

    def delete(self, request, slug, pk):
        workspace, _, policy = self.context(request, slug)
        if policy.is_restricted:
            raise NotFound()
        obj = active_presentation(request.user, workspace, pk, write=True)
        from plane.app.services.presentations import Conflict, require_version
        with transaction.atomic():
            obj = Presentation.objects.select_for_update().select_related("workspace", "project").filter(
                pk=obj.pk, workspace=workspace, deleted_at__isnull=True,
                workspace__deleted_at__isnull=True, project__deleted_at__isnull=True,
            ).first()
            if obj is None:
                raise NotFound()
            if not can_edit(request.user, obj):
                from rest_framework.exceptions import PermissionDenied
                raise PermissionDenied()
            require_version(obj, request.data.get("version"))
            obj.deleted_at = timezone.now()
            obj.version += 1
            obj.save(update_fields=["deleted_at", "version", "updated_at"])
        return Response(status=status.HTTP_204_NO_CONTENT)


class PresentationAssetEndpoint(AttachmentPreviewResponseMixin, BaseAPIView):
    access_policy_capability = "presentation.material.read"

    def get(self, request, slug, pk, asset_id, resource=""):
        workspace = get_object_or_404(Workspace, slug=slug, deleted_at__isnull=True)
        obj = active_presentation(request.user, workspace, pk)
        from plane.utils.access_policy import get_workspace_access_policy
        policy = get_workspace_access_policy(request, slug)
        draft = request.query_params.get("view") == "draft"
        if draft:
            if policy.is_restricted or not can_edit(request.user, obj):
                raise NotFound()
            document = obj.document
            revision_id = None
        else:
            if not obj.published_revision:
                raise NotFound()
            document = obj.published_revision.snapshot.get("document", {})
            revision_id = obj.published_revision_id
            policy.require("presentation.published.read", project_id=obj.project_id)
            policy.require("presentation.material.read", project_id=obj.project_id)
        policy.require_document(document)
        media_ids = {str(media.get(key)) for section in document.get("sections", []) for slide in section.get("slides", []) for media in slide.get("media", []) for key in ("asset_id", "preview_asset_id") if media.get(key)}
        preview_sources = {str(media["preview_asset_id"]): str(media["asset_id"]) for section in document.get("sections", []) for slide in section.get("slides", []) for media in slide.get("media", []) if media.get("preview_asset_id")}
        if str(asset_id) not in media_ids:
            raise NotFound()
        asset = FileAsset.objects.filter(id=asset_id, workspace=workspace, project=obj.project, is_uploaded=True, is_deleted=False, deleted_at__isnull=True).select_related("issue", "comment").first()
        if asset is None:
            raise NotFound()
        if str(asset_id) in preview_sources:
            from plane.app.services.presentations import presentation_preview_asset_matches
            source = FileAsset.objects.filter(id=preview_sources[str(asset_id)], workspace=workspace, project=obj.project, is_uploaded=True, is_deleted=False, deleted_at__isnull=True).first()
            if source is None or not presentation_preview_asset_matches(asset, source, obj):
                raise NotFound()
        if asset.entity_type == "PRESENTATION_ATTACHMENT":
            from plane.app.services.presentations import presentation_derived_asset_is_live
            if str(asset.entity_identifier) != str(obj.id) or not presentation_derived_asset_is_live(asset, obj):
                raise NotFound()
        else:
            from plane.app.services.presentations import presentation_source_asset_is_live
            if not presentation_source_asset_is_live(asset, workspace, obj.project):
                raise NotFound()
        from plane.app.services.presentations import can_view_project_media
        if not can_view_project_media(request.user, obj, asset, restricted=policy.is_restricted):
            raise NotFound()
        if not resource or resource == "source":
            return source_response(asset, request)
        request.artifact_preview_claim = {"presentation": str(obj.id), "revision": str(revision_id) if revision_id else None,
                                          "draft_version": obj.version if draft else None, "user": str(request.user.id), "asset": str(asset.id)}
        return preview_authorized_asset(request, asset, resource)


class APIKeyPresentationEndpoint(PresentationEndpoint):
    authentication_classes = [APIKeyAuthentication]

    def get_throttles(self):
        return [ApiKeyRateThrottle()]
