from django.shortcuts import get_object_or_404
from django.conf import settings
from django.db import IntegrityError, transaction
from django.db.models import Q
from django.utils import timezone
from django.utils.text import get_valid_filename
from uuid import uuid4
from rest_framework import status
from rest_framework.parsers import MultiPartParser, FormParser
from rest_framework.response import Response
from rest_framework.exceptions import NotFound, PermissionDenied

from plane.app.permissions import ROLE
from plane.app.services.artifacts import (
    active_artifact, can_edit, create_artifact, member_role, published_snapshot,
    publish_artifact, serialize_artifact, transition_artifact, update_artifact,
)
from plane.app.views.base import BaseAPIView
from plane.db.models import Artifact, ArtifactCategory, ArtifactRevision, FileAsset, Issue, ProjectMember, Workspace
from plane.settings.storage import S3Storage
from plane.api.middleware.api_authentication import APIKeyAuthentication
from plane.api.rate_limit import ApiKeyRateThrottle


class ArtifactEndpoint(BaseAPIView):
    def workspace(self, slug):
        ws = get_object_or_404(Workspace, slug=slug, deleted_at__isnull=True)
        if member_role(self.request.user, ws) is None:
            from rest_framework.exceptions import NotFound
            raise NotFound()
        return ws

    def get(self, request, slug, pk=None):
        ws = self.workspace(slug)
        if pk:
            obj = active_artifact(request.user, ws, pk)
            return Response(serialize_artifact(obj, request.user, request.query_params.get("view", "published")))
        manage = request.query_params.get("scope") == "manage"
        qs = Artifact.objects.filter(workspace=ws, deleted_at__isnull=True)
        if manage:
            if member_role(request.user, ws) != ROLE.ADMIN.value:
                qs = qs.filter(Q(access=Artifact.Access.WORKSPACE) | Q(owner=request.user))
        else:
            qs = qs.filter(status=Artifact.Status.PUBLISHED)
        qs = qs.order_by("-updated_at", "id") if manage else qs.order_by("created_at", "id")
        term = request.query_params.get("search", "").strip()
        if term:
            qs = qs.filter(title__icontains=term) | qs.filter(summary__icontains=term)
        rows = []
        for obj in qs.select_related("published_revision", "category", "owner"):
            try:
                rows.append(serialize_artifact(obj, request.user, "draft" if manage and can_edit(request.user, obj) else "published"))
            except (NotFound, PermissionDenied):
                continue
        return Response({"results": rows, "count": len(rows), "can_create": member_role(request.user, ws) in (ROLE.ADMIN.value, ROLE.MEMBER.value)})

    def post(self, request, slug, pk=None, action=None, revision_id=None):
        ws = self.workspace(slug)
        if action == "publish":
            obj = active_artifact(request.user, ws, pk, write=True)
            obj = publish_artifact(request.user, obj, request.data.get("version"))
            return Response(serialize_artifact(obj, request.user, "published"))
        if action == "withdraw":
            obj = active_artifact(request.user, ws, pk, write=True)
            obj = transition_artifact(request.user, obj, request.data.get("version"), Artifact.Status.WITHDRAWN)
            return Response({"id": str(obj.id), "status": obj.status, "version": obj.version})
        if action == "restore":
            obj = active_artifact(request.user, ws, pk, write=True)
            from plane.app.services.artifacts.restore import restore_revision
            obj = restore_revision(request.user, obj, revision_id or request.data.get("revision_id"), request.data.get("version"))
            return Response(serialize_artifact(obj, request.user, "draft"))
        obj = create_artifact(request.user, ws, request.data)
        return Response(serialize_artifact(obj, request.user, "draft"), status=status.HTTP_201_CREATED)

    def patch(self, request, slug, pk):
        ws = self.workspace(slug)
        obj = active_artifact(request.user, ws, pk, write=True)
        obj = update_artifact(request.user, obj, request.data)
        return Response(serialize_artifact(obj, request.user, "draft"))

    def delete(self, request, slug, pk):
        ws = self.workspace(slug)
        obj = active_artifact(request.user, ws, pk, write=True)
        from plane.app.services.artifacts.service import _lock_version, require_artifact_write
        with transaction.atomic():
            obj = Artifact.objects.select_for_update().get(pk=obj.pk)
            _lock_version(obj, request.data.get("version"))
            require_artifact_write(request.user, obj)
            obj.deleted_at = timezone.now()
            obj.version += 1
            obj.save(update_fields=["deleted_at", "version", "updated_at"])
        return Response(status=status.HTTP_204_NO_CONTENT)


class ArtifactRevisionEndpoint(ArtifactEndpoint):
    def get(self, request, slug, pk=None, revision_id=None):
        ws = self.workspace(slug)
        obj = active_artifact(request.user, ws, pk)
        if not can_edit(request.user, obj):
            from rest_framework.exceptions import PermissionDenied
            raise PermissionDenied()
        from plane.app.services.artifacts.service import authorize_snapshot_sources
        revisions = obj.revisions.select_related("actor").all()
        def actor_name(actor):
            if actor is None:
                return "已删除成员"
            return actor.display_name or actor.full_name or "已删除成员"
        if revision_id:
            revision = get_object_or_404(revisions, id=revision_id)
            authorize_snapshot_sources(request.user, ws, revision.snapshot)
            return Response({"id": str(revision.id), "version": revision.number, "snapshot": revision.snapshot, "actor": str(revision.actor_id) if revision.actor_id else None,
                             "actor_name": actor_name(revision.actor), "created_at": revision.created_at})
        visible = []
        for revision in revisions:
            try:
                authorize_snapshot_sources(request.user, ws, revision.snapshot)
                visible.append(revision)
            except NotFound:
                continue
        return Response({"results": [{"id": str(r.id), "version": r.number, "actor": str(r.actor_id) if r.actor_id else None,
                                      "actor_name": actor_name(r.actor), "created_at": r.created_at} for r in visible]})


class ArtifactCategoryEndpoint(BaseAPIView):
    def _workspace(self, slug):
        ws = get_object_or_404(Workspace, slug=slug, deleted_at__isnull=True)
        from plane.app.services.artifacts import require_workspace
        require_workspace(self.request.user, ws)
        return ws

    def get(self, request, slug, pk=None):
        ws = self._workspace(slug)
        if pk:
            category = get_object_or_404(ArtifactCategory, id=pk, workspace=ws, deleted_at__isnull=True)
            return Response(self._serialize(category))
        return Response({"results": [self._serialize(c) for c in ArtifactCategory.objects.filter(workspace=ws, deleted_at__isnull=True).order_by("name", "id")], "can_manage": member_role(request.user, ws) in (ROLE.ADMIN.value, ROLE.MEMBER.value)})

    def _serialize(self, category):
        from plane.db.models import ArtifactRevision
        used = set(Artifact.objects.filter(category=category, deleted_at__isnull=True).values_list("id", flat=True))
        used.update(artifact_id for artifact_id, snapshot in ArtifactRevision.objects.filter(artifact__workspace=category.workspace).values_list("artifact_id", "snapshot") if snapshot.get("category_id") == str(category.id))
        return {"id": str(category.id), "name": category.name, "usage_count": len(used), "version": category.version}

    def post(self, request, slug, pk=None):
        ws = self._workspace(slug)
        if member_role(request.user, ws) not in (ROLE.ADMIN.value, ROLE.MEMBER.value):
            from rest_framework.exceptions import PermissionDenied
            raise PermissionDenied()
        name = str(request.data.get("name", "")).strip()
        if not name or len(name) > 120:
            return Response({"name": "分类名称必填且不能超过 120 个字符。"}, status=400)
        try:
            with transaction.atomic():
                category = ArtifactCategory.objects.create(workspace=ws, name=name)
        except IntegrityError:
            return Response({"name": "该分类名称已存在。"}, status=400)
        return Response(self._serialize(category), status=201)

    def patch(self, request, slug, pk):
        ws = self._workspace(slug)
        if member_role(request.user, ws) not in (ROLE.ADMIN.value, ROLE.MEMBER.value):
            from rest_framework.exceptions import PermissionDenied
            raise PermissionDenied()
        category = get_object_or_404(ArtifactCategory, id=pk, workspace=ws, deleted_at__isnull=True)
        if request.data.get("version") is None:
            return Response({"version": "必须提供分类版本号。"}, status=400)
        try:
            with transaction.atomic():
                category = ArtifactCategory.objects.select_for_update().get(pk=category.pk)
                try:
                    supplied_version = int(request.data["version"])
                except (TypeError, ValueError):
                    return Response({"version": "分类版本号必须是整数。"}, status=400)
                if supplied_version != category.version:
                    from plane.app.services.artifacts.service import Conflict
                    raise Conflict()
                name = str(request.data.get("name", "")).strip()
                if not name or len(name) > 120:
                    return Response({"name": "分类名称必填且不能超过 120 个字符。"}, status=400)
                category.name = name
                category.version += 1
                category.save(update_fields=["name", "version", "updated_at"])
        except IntegrityError:
            return Response({"name": "该分类名称已存在。"}, status=400)
        return Response(self._serialize(category))

    def delete(self, request, slug, pk):
        ws = self._workspace(slug)
        if member_role(request.user, ws) not in (ROLE.ADMIN.value, ROLE.MEMBER.value):
            from rest_framework.exceptions import PermissionDenied
            raise PermissionDenied()
        category = get_object_or_404(ArtifactCategory, id=pk, workspace=ws, deleted_at__isnull=True)
        if request.data.get("version") is None:
            return Response({"version": "必须提供分类版本号。"}, status=400)
        with transaction.atomic():
            category = ArtifactCategory.objects.select_for_update().get(pk=category.pk)
            try:
                supplied_version = int(request.data["version"])
            except (TypeError, ValueError):
                return Response({"version": "分类版本号必须是整数。"}, status=400)
            if supplied_version != category.version:
                from plane.app.services.artifacts.service import Conflict
                raise Conflict()
            if self._serialize(category)["usage_count"]:
                return Response({"error": "分类仍被成果或修订使用。", "usage_count": self._serialize(category)["usage_count"]}, status=409)
            category.deleted_at = timezone.now()
            category.version += 1
            category.save(update_fields=["deleted_at", "version", "updated_at"])
        return Response(status=204)


class ArtifactSourceEndpoint(BaseAPIView):
    def get(self, request, slug, pk=None):
        ws = get_object_or_404(Workspace, slug=slug, deleted_at__isnull=True)
        from plane.app.services.artifacts import require_workspace, can_project
        require_workspace(request.user, ws)
        if pk:
            issue = get_object_or_404(Issue.issue_objects.select_related("project"), id=pk, workspace=ws, deleted_at__isnull=True)
            if not can_project(request.user, issue):
                from rest_framework.exceptions import NotFound
                raise NotFound()
            assets = FileAsset.objects.filter(Q(issue=issue) | Q(comment__issue=issue, comment__deleted_at__isnull=True), is_uploaded=True, is_deleted=False, deleted_at__isnull=True,
                                              entity_type__in=[FileAsset.EntityTypeContext.ISSUE_ATTACHMENT, FileAsset.EntityTypeContext.ISSUE_DESCRIPTION, FileAsset.EntityTypeContext.COMMENT_DESCRIPTION])
            return Response({"results": [{"id": str(a.id), "name": a.attributes.get("name", "附件"), "type": a.attributes.get("type", "application/octet-stream"), "size": int(a.size or 0)} for a in assets]})
        q = request.query_params.get("search", "").strip()
        from plane.app.services.artifacts import can_project, source_assignee_ids
        from plane.app.permissions import ROLE
        allowed_projects = set(ProjectMember.objects.filter(workspace=ws, member=request.user, is_active=True, deleted_at__isnull=True).values_list("project_id", flat=True))
        issues = Issue.issue_objects.filter(workspace=ws, project_id__in=allowed_projects, deleted_at__isnull=True).select_related("project")
        results = []
        term = q.casefold()
        for issue in issues:
            identifier = f"{issue.project.identifier}-{issue.sequence_id}"
            if term and term not in identifier.casefold() and term not in issue.name.casefold() and term not in issue.project.name.casefold():
                continue
            results.append({"id": str(issue.id), "identifier": identifier, "name": issue.name, "project_id": str(issue.project_id), "assignee_ids": source_assignee_ids(issue)})
            if len(results) == 100:
                break
        return Response({"results": results})


class ArtifactUploadEndpoint(BaseAPIView):
    parser_classes = [MultiPartParser, FormParser]

    def post(self, request, slug, pk):
        ws = get_object_or_404(Workspace, slug=slug, deleted_at__isnull=True)
        obj = active_artifact(request.user, ws, pk, write=True)
        upload = request.FILES.get("file")
        size_limit = settings.FILE_SIZE_LIMIT
        if not upload or upload.size <= 0 or upload.size > size_limit:
            return Response({"error": f"文件不能为空且不能超过 {size_limit} 字节。"}, status=400)
        object_name = f"{ws.id}/{obj.id}/{uuid4().hex}-{get_valid_filename(upload.name)}"
        storage = S3Storage()
        try:
            uploaded = storage.upload_file(upload, object_name, upload.content_type or "application/octet-stream")
        except Exception:
            return Response({"error": "文件存储失败，请重试。"}, status=502)
        if not uploaded:
            return Response({"error": "文件存储失败，请重试。"}, status=502)
        asset = FileAsset(workspace=ws, user=request.user, entity_type=FileAsset.EntityTypeContext.ARTIFACT_ATTACHMENT,
                          entity_identifier=str(obj.id), attributes={"name": upload.name, "size": upload.size, "type": upload.content_type or "application/octet-stream"},
                          size=upload.size, is_uploaded=True)
        asset.asset.name = object_name
        try:
            asset.save()
        except Exception:
            storage.delete_files([object_name])
            raise
        return Response({"id": str(asset.id), "name": upload.name, "size": upload.size, "type": asset.attributes["type"]}, status=201)


class APIKeyArtifactEndpoint(ArtifactEndpoint):
    authentication_classes = [APIKeyAuthentication]
    def get_throttles(self):
        return [ApiKeyRateThrottle()]


class APIKeyArtifactRevisionEndpoint(ArtifactRevisionEndpoint):
    authentication_classes = [APIKeyAuthentication]
    def get_throttles(self):
        return [ApiKeyRateThrottle()]


class APIKeyArtifactCategoryEndpoint(ArtifactCategoryEndpoint):
    authentication_classes = [APIKeyAuthentication]
    def get_throttles(self):
        return [ApiKeyRateThrottle()]


class APIKeyArtifactSourceEndpoint(ArtifactSourceEndpoint):
    authentication_classes = [APIKeyAuthentication]
    def get_throttles(self):
        return [ApiKeyRateThrottle()]


class APIKeyArtifactUploadEndpoint(ArtifactUploadEndpoint):
    authentication_classes = [APIKeyAuthentication]
    def get_throttles(self):
        return [ApiKeyRateThrottle()]
