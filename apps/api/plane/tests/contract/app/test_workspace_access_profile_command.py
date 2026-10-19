from io import StringIO
from unittest.mock import patch

from django.core.management import call_command, CommandError
from django.test import TestCase, RequestFactory
from rest_framework.exceptions import PermissionDenied

from plane.db.models import (
    IssueView,
    Project,
    ProjectMember,
    User,
    Workspace,
    WorkspaceMember,
    WorkspaceMemberProjectGrant,
    WorkspaceMemberViewGrant,
)
from plane.utils.access_policy import get_workspace_access_policy


class TestSetWorkspaceAccessProfileCommand(TestCase):
    def setUp(self):
        self.user = User.objects.create(
            email="profile-command@example.test",
            first_name="Profile",
            last_name="Command",
        )
        self.workspace = Workspace.objects.create(name="Primary", slug="profile-primary", owner=self.user)
        self.other_workspace = Workspace.objects.create(name="Other", slug="profile-other", owner=self.user)
        self.membership = WorkspaceMember.objects.create(
            workspace=self.workspace, member=self.user, role=5, access_profile="summary_observer"
        )
        self.project_a = self.make_project(self.workspace, "PRA")
        self.project_b = self.make_project(self.workspace, "PRB")
        self.other_project = self.make_project(self.other_workspace, "OTH")
        for project in (self.project_a, self.project_b, self.other_project):
            ProjectMember.objects.create(project=project, member=self.user, role=5, is_active=True)
        self.view_a = self.make_view(self.project_a, "Shared A", access=1)
        self.view_b = self.make_view(self.project_b, "Shared B", access=1)
        self.private_view = self.make_view(self.project_a, "Private", access=0)
        self.other_view = self.make_view(self.other_project, "Other shared", access=1)
        self.project_grant_a = WorkspaceMemberProjectGrant.objects.create(
            workspace_member=self.membership, project=self.project_a
        )
        self.view_grant_a = WorkspaceMemberViewGrant.objects.create(
            workspace_member=self.membership, view=self.view_a
        )

    @staticmethod
    def make_project(workspace, identifier):
        return Project.objects.create(name=identifier, identifier=identifier, workspace=workspace)

    def make_view(self, project, name, access):
        return IssueView.objects.create(
            workspace=project.workspace,
            project=project,
            name=name,
            query={},
            filters={},
            owned_by=self.user,
            access=access,
        )

    def command(self, scope, profile="summary_observer", dry_run=False):
        projects, views = scope
        args = ["--workspace", self.workspace.slug, "--email", self.user.email, "--profile", profile]
        for project in projects:
            args.extend(("--project", str(project.id)))
        for view in views:
            args.extend(("--view", str(view.id)))
        if dry_run:
            args.append("--dry-run")
        return call_command("set_workspace_access_profile", *args, stdout=StringIO())

    def active_project_ids(self):
        return set(
            WorkspaceMemberProjectGrant.objects.filter(workspace_member=self.membership)
            .values_list("project_id", flat=True)
        )

    def active_view_ids(self):
        return set(
            WorkspaceMemberViewGrant.objects.filter(workspace_member=self.membership)
            .values_list("view_id", flat=True)
        )

    def test_dry_run_validates_without_writing_profile_or_scope(self):
        self.command(([self.project_b], [self.view_b]), dry_run=True)

        self.membership.refresh_from_db()
        self.assertEqual(self.membership.access_profile, "summary_observer")
        self.assertEqual(self.active_project_ids(), {self.project_a.id})
        self.assertEqual(self.active_view_ids(), {self.view_a.id})

    def test_rejects_cross_workspace_project_and_view_and_private_view(self):
        for scope in (([self.other_project], []), ([self.project_a], [self.other_view]),
                      ([self.project_a], [self.private_view])):
            with self.subTest(scope=scope), self.assertRaises(CommandError):
                self.command(scope)
            self.assertEqual(self.active_project_ids(), {self.project_a.id})
            self.assertEqual(self.active_view_ids(), {self.view_a.id})
            self.membership.refresh_from_db()
            self.assertEqual(self.membership.access_profile, "summary_observer")

    def test_success_replaces_scope_and_preserves_numeric_role(self):
        self.command(([self.project_b], [self.view_b]))

        self.membership.refresh_from_db()
        self.assertEqual(self.membership.role, 5)
        self.assertEqual(self.membership.access_profile, "summary_observer")
        self.assertEqual(self.active_project_ids(), {self.project_b.id})
        self.assertEqual(self.active_view_ids(), {self.view_b.id})
        self.assertIsNotNone(WorkspaceMemberProjectGrant.all_objects.get(pk=self.project_grant_a.pk).deleted_at)
        self.assertIsNotNone(WorkspaceMemberViewGrant.all_objects.get(pk=self.view_grant_a.pk).deleted_at)

    def test_failed_replacement_rolls_back_grant_deletion_and_profile_change(self):
        with patch(
            "plane.db.management.commands.set_workspace_access_profile.WorkspaceMemberViewGrant.objects.bulk_create",
            side_effect=RuntimeError("simulated view grant write failure"),
        ), self.assertRaises(RuntimeError):
            self.command(([self.project_b], [self.view_b]), profile="summary_observer")

        self.membership.refresh_from_db()
        self.assertEqual(self.membership.role, 5)
        self.assertEqual(self.membership.access_profile, "summary_observer")
        self.assertEqual(self.active_project_ids(), {self.project_a.id})
        self.assertEqual(self.active_view_ids(), {self.view_a.id})

    def test_removed_scope_is_denied_on_the_next_request(self):
        self.command(([], []))

        request = RequestFactory().get("/")
        request.user = self.user
        policy = get_workspace_access_policy(request, self.workspace.slug)
        self.assertEqual(policy.allowed_project_ids, frozenset())
        self.assertEqual(policy.allowed_view_ids, frozenset())
        with self.assertRaises(PermissionDenied):
            policy.require("project.summary.read", project_id=self.project_a.id)
        with self.assertRaises(PermissionDenied):
            policy.require("view.summary.read", project_id=self.project_a.id, view_id=self.view_a.id)
