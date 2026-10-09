"""Shared template contracts; Django runner uses its isolated test database."""
import uuid
from django.test import TestCase
from rest_framework.test import APIRequestFactory, force_authenticate
from plane.db.models import User, Workspace, WorkspaceMember, Project, ProjectMember, WorkItemTemplate
from plane.app.views.work_item_template import WorkItemTemplateEndpoint
from plane.api.views.work_item_template import WorkItemTemplateAPIEndpoint


class WorkItemTemplateTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        cls.admin = User.objects.create(email="template-admin@example.invalid", username="template-admin")
        cls.member = User.objects.create(email="template-member@example.invalid", username="template-member")
        cls.outsider = User.objects.create(email="template-outsider@example.invalid", username="template-outsider")
        cls.workspace = Workspace.objects.create(name="Template QA", slug="template-qa", owner=cls.admin)
        cls.project = Project.objects.create(name="Template QA", identifier="TQA", workspace=cls.workspace)
        cls.other = Project.objects.create(name="Other QA", identifier="OQA", workspace=cls.workspace)
        for user, role in [(cls.admin, 20), (cls.member, 15)]:
            WorkspaceMember.objects.create(workspace=cls.workspace, member=user, role=role)
            ProjectMember.objects.create(project=cls.project, workspace=cls.workspace, member=user, role=role)
            ProjectMember.objects.create(project=cls.other, workspace=cls.workspace, member=user, role=role)

    def request(self, method, user=None, data=None, pk=None, project=None, slug="template-qa", endpoint=WorkItemTemplateEndpoint):
        request = getattr(APIRequestFactory(), method)("/templates/", data or {}, format="json")
        if user is not None:
            force_authenticate(request, user=user)
        kwargs = {"slug": slug, "project_id": (project or self.project).id}
        if pk:
            kwargs["pk"] = pk
        return endpoint.as_view()(request, **kwargs)

    def create(self, name="任务", **kwargs):
        response = self.request("post", self.admin, {"name": name, "description_html": "<table><tr><td>交付物</td><td>成果</td></tr></table>", **kwargs})
        self.assertEqual(response.status_code, 201, response.data)
        return response.data

    def test_member_can_read_but_cannot_manage(self):
        item = self.create()
        response = self.request("get", self.member)
        self.assertFalse(response.data["can_manage"])
        self.assertEqual(len(response.data["results"]), 1)
        for method in ["post", "patch", "delete"]:
            self.assertEqual(self.request(method, self.member, {"name": "拒绝"}, pk=item["id"] if method != "post" else None).status_code, 403)

    def test_outsider_and_anonymous_denied(self):
        self.assertEqual(self.request("get", self.outsider).status_code, 403)
        self.assertIn(self.request("get").status_code, [401, 403])

    def test_cross_project_and_workspace_denied(self):
        item = self.create()
        self.assertEqual(self.request("patch", self.admin, {"version": 1, "name": "越界"}, pk=item["id"], project=self.other).status_code, 404)
        self.assertEqual(self.request("get", self.admin, slug="wrong-workspace").status_code, 404)

    def test_single_default_and_version_conflict(self):
        first = self.create("第一", is_default=True)
        second = self.create("第二", is_default=True)
        self.assertEqual(WorkItemTemplate.objects.filter(project=self.project, is_default=True).count(), 1)
        self.assertTrue(WorkItemTemplate.objects.get(pk=second["id"]).is_default)
        response = self.request("patch", self.admin, {"version": second["version"], "name": "修改"}, pk=second["id"])
        self.assertEqual(response.status_code, 200)
        self.assertEqual(self.request("patch", self.admin, {"version": second["version"], "name": "过期"}, pk=second["id"]).status_code, 409)

    def test_html_sanitized_and_table_preserved(self):
        item = self.create(description_html='<script>alert(1)</script><table><tr><td onclick="alert(1)">需求</td></tr></table>')
        self.assertIn("<table>", item["description_html"])
        self.assertNotIn("<script", item["description_html"])
        self.assertNotIn("onclick", item["description_html"])

    def test_recommendations_validate_project_members(self):
        response = self.request("post", self.admin, {"name": "错误", "recommended_member_ids": [str(uuid.uuid4())]})
        self.assertEqual(response.status_code, 400)
        item = self.create(recommended_member_ids=[str(self.member.id)])
        self.assertEqual(item["recommended_member_ids"], [str(self.member.id)])

    def test_api_endpoint_crud_uses_same_project_authority(self):
        item = self.create()
        response = self.request("get", self.admin, endpoint=WorkItemTemplateAPIEndpoint)
        self.assertTrue(response.data["can_manage"])
        self.assertEqual(self.request("delete", self.admin, pk=item["id"], endpoint=WorkItemTemplateAPIEndpoint).status_code, 204)
        self.assertEqual(WorkItemTemplate.objects.count(), 0)

    def test_blank_name_and_oversized_body_rejected(self):
        self.assertEqual(self.request("post", self.admin, {"name": "  "}).status_code, 400)
        self.assertEqual(self.request("post", self.admin, {"name": "大", "description_html": "x" * 100001}).status_code, 400)
