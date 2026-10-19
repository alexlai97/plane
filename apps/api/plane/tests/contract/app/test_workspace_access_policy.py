from django.test import TestCase
from django.urls import reverse
from rest_framework.exceptions import PermissionDenied
from rest_framework.test import APIClient

from plane.db.models import (
    APIToken,
    Issue,
    Profile,
    Project,
    ProjectMember,
    User,
    Workspace,
    WorkspaceMember,
    WorkspaceMemberProjectGrant,
)
from plane.utils.access_policy import WorkspaceAccessPolicy


class TestWorkspaceAccessPolicy(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.user = User.objects.create(
            email="observer-policy@example.test",
            first_name="Observer",
            last_name="Policy",
        )
        self.user.set_password("test-password")
        self.user.save()
        self.workspace = Workspace.objects.create(name="Policy test", slug="policy-test", owner=self.user)
        self.membership = WorkspaceMember.objects.create(
            workspace=self.workspace,
            member=self.user,
            role=5,
            access_profile="summary_observer",
        )
        self.client.force_authenticate(user=self.user)

    def test_policy_api_reports_explicit_empty_scope(self):
        response = self.client.get(reverse("workspace-access-policy", kwargs={"slug": self.workspace.slug}))

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["profile"], "summary_observer")
        self.assertIn("view.summary.read", response.data["capabilities"])
        self.assertEqual(response.data["project_ids"], [])
        self.assertEqual(response.data["view_ids"], [])

    def test_unscoped_activity_is_denied_but_self_and_password_bootstrap_remain_available(self):
        denied = self.client.get("/api/users/me/activities/")
        self.assertEqual(denied.status_code, 403)

        self.assertEqual(self.client.get("/api/users/me/").status_code, 200)
        # A missing new password is rejected by the password endpoint itself,
        # proving the profile guard did not block the account-security route.
        password = self.client.post("/auth/change-password/", {}, format="json")
        self.assertEqual(password.status_code, 400)

        self.membership.access_profile = "standard"
        self.membership.save(update_fields=["access_profile", "updated_at"])
        self.assertEqual(self.client.get("/api/users/me/activities/").status_code, 200)

    def test_api_key_work_item_detail_is_denied_to_observer_and_preserved_for_standard(self):
        project = Project.objects.create(name="Policy project", identifier="POL", workspace=self.workspace)
        ProjectMember.objects.create(project=project, member=self.user, role=5, is_active=True)
        issue = Issue.objects.create(project=project, name="Private detail", description_html="<p>private body</p>")
        WorkspaceMemberProjectGrant.objects.create(workspace_member=self.membership, project=project)
        token = APIToken.objects.create(label="Policy test", token="observer-policy-token", user=self.user)
        client = APIClient()
        client.credentials(HTTP_X_API_KEY=token.token)
        url = f"/api/v1/workspaces/{self.workspace.slug}/projects/{project.id}/work-items/{issue.id}/"

        denied = client.get(url)
        self.assertEqual(denied.status_code, 403)

        self.membership.access_profile = "standard"
        self.membership.save(update_fields=["access_profile", "updated_at"])
        ordinary = client.get(url)
        self.assertEqual(ordinary.status_code, 200)
        self.assertIn("private body", str(ordinary.data))

    def test_capability_and_resource_scopes_are_both_required(self):
        policy = WorkspaceAccessPolicy(
            profile="summary_observer",
            capabilities=frozenset({"view.summary.read"}),
            allowed_project_ids=frozenset({"project-a"}),
            allowed_view_ids=frozenset({"view-a"}),
            workspace_id="workspace-a",
        )

        self.assertTrue(policy.require("view.summary.read", project_id="project-a", view_id="view-a"))
        with self.assertRaises(PermissionDenied):
            policy.require("view.summary.read", project_id="project-b", view_id="view-a")
        with self.assertRaises(PermissionDenied):
            policy.require("work_item.detail.read", project_id="project-a", view_id="view-a")

    def test_unknown_access_profile_fails_closed(self):
        self.membership.access_profile = "unregistered_profile"
        self.membership.save(update_fields=["access_profile", "updated_at"])

        response = self.client.get(f"/api/workspaces/{self.workspace.slug}/home-preferences/")
        self.assertEqual(response.status_code, 403)

    def test_last_workspace_bootstrap_projects_are_limited_to_observer_scope(self):
        granted = Project.objects.create(name="Granted", identifier="GRT", workspace=self.workspace)
        ungranted = Project.objects.create(name="Unassigned", identifier="UNA", workspace=self.workspace)
        for project in (granted, ungranted):
            ProjectMember.objects.create(project=project, member=self.user, role=5, is_active=True)
        WorkspaceMemberProjectGrant.objects.create(workspace_member=self.membership, project=granted)
        profile, _ = Profile.objects.get_or_create(user=self.user)
        profile.last_workspace_id = self.workspace.id
        profile.save(update_fields=["last_workspace_id"])

        response = self.client.get("/api/users/last-visited-workspace/")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["workspace_details"]["slug"], self.workspace.slug)
        self.assertEqual([str(row["project"]["id"]) for row in response.data["project_details"]], [str(granted.id)])

        self.membership.access_profile = "standard"
        self.membership.save(update_fields=["access_profile", "updated_at"])
        standard = self.client.get("/api/users/last-visited-workspace/")
        self.assertEqual(standard.status_code, 200)
        self.assertEqual(
            {str(row["project"]["id"]) for row in standard.data["project_details"]},
            {str(granted.id), str(ungranted.id)},
        )
