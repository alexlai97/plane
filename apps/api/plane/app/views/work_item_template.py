from django.db import transaction
from django.db.models import F
from django.shortcuts import get_object_or_404
from rest_framework import serializers
from rest_framework.exceptions import PermissionDenied
from rest_framework.response import Response
from plane.app.views.base import BaseAPIView
from plane.db.models import Project, ProjectMember, WorkspaceMember, WorkItemTemplate
from plane.utils.content_validator import validate_html_content


class TemplateSerializer(serializers.ModelSerializer):
    class Meta:
        model = WorkItemTemplate
        fields = ["id", "key", "name", "description_html", "recommended_member_ids", "is_default", "version", "created_at", "updated_at"]
        read_only_fields = ["id", "version", "created_at", "updated_at"]

    def validate_name(self, value):
        value = value.strip()
        if not value:
            raise serializers.ValidationError("请输入模板名称。")
        return value

    def validate_description_html(self, value):
        if len(value.encode("utf-8")) > 100000:
            raise serializers.ValidationError("模板描述过长。")
        valid, error, clean = validate_html_content(value)
        if not valid:
            raise serializers.ValidationError(error)
        return clean or ""

    def validate_recommended_member_ids(self, value):
        if not isinstance(value, list) or len(value) > 100:
            raise serializers.ValidationError("推荐成员必须是列表。")
        try:
            import uuid
            ids = list(dict.fromkeys(str(uuid.UUID(str(item))) for item in value))
        except (ValueError, TypeError, AttributeError):
            raise serializers.ValidationError("成员标识无效。")
        count = ProjectMember.objects.filter(project_id=self.context["project_id"], member_id__in=ids, is_active=True).count()
        if count != len(ids):
            raise serializers.ValidationError("推荐成员必须属于本项目。")
        return ids


class TemplateEndpointMixin:
    def access(self, request, slug, project_id, write=False):
        project = get_object_or_404(Project, id=project_id, workspace__slug=slug)
        role = ProjectMember.objects.filter(project=project, member=request.user, is_active=True).values_list("role", flat=True).first()
        admin = role == 20 or (role is not None and WorkspaceMember.objects.filter(workspace=project.workspace, member=request.user, role=20, is_active=True).exists())
        if role is None or role < 15 or (write and not admin):
            raise PermissionDenied("只有项目成员可以使用模板，管理员可以维护模板。")
        return project, admin

    def get(self, request, slug, project_id, pk=None):
        project, admin = self.access(request, slug, project_id)
        rows = WorkItemTemplate.objects.filter(project=project).order_by("-is_default", "created_at")
        if pk:
            return Response(TemplateSerializer(get_object_or_404(rows, pk=pk)).data)
        return Response({"results": TemplateSerializer(rows, many=True).data, "can_manage": admin})

    def save_template(self, request, slug, project_id, pk=None):
        project, _ = self.access(request, slug, project_id, write=True)
        with transaction.atomic():
            Project.objects.select_for_update().get(pk=project.pk)
            instance = get_object_or_404(WorkItemTemplate, project=project, pk=pk) if pk else None
            if instance and request.data.get("version") != instance.version:
                return Response({"error": "模板已被他人修改，请重新打开后编辑。"}, status=409)
            serializer = TemplateSerializer(instance, data=request.data, partial=bool(pk), context={"project_id": project.pk})
            serializer.is_valid(raise_exception=True)
            if serializer.validated_data.get("is_default"):
                WorkItemTemplate.objects.filter(project=project, is_default=True).exclude(pk=pk).update(is_default=False, version=F("version") + 1)
            serializer.save(project=project, version=instance.version + 1 if instance else 1)
            return Response(serializer.data, status=200 if pk else 201)

    def post(self, request, slug, project_id, pk=None):
        if pk:
            return Response(status=405)
        return self.save_template(request, slug, project_id)

    def patch(self, request, slug, project_id, pk=None):
        if not pk:
            return Response(status=405)
        return self.save_template(request, slug, project_id, pk)

    def delete(self, request, slug, project_id, pk=None):
        project, _ = self.access(request, slug, project_id, write=True)
        if not pk:
            return Response(status=405)
        with transaction.atomic():
            Project.objects.select_for_update().get(pk=project.pk)
            get_object_or_404(WorkItemTemplate, project=project, pk=pk).delete()
        return Response(status=204)


class WorkItemTemplateEndpoint(TemplateEndpointMixin, BaseAPIView):
    pass
