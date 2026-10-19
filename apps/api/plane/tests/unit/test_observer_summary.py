from django.test import TestCase
from rest_framework.exceptions import NotFound, PermissionDenied
from rest_framework.test import APIRequestFactory, force_authenticate
from types import SimpleNamespace

from plane.app.views.observer import SummaryViewListEndpoint, SummaryViewWorkItemsEndpoint
from plane.db.models import (
    Artifact, ArtifactRevision, Issue, IssueView, Project, ProjectMember,
    User, Workspace, WorkspaceMember, WorkspaceMemberProjectGrant,
    WorkspaceMemberViewGrant,
)
from plane.app.services.artifacts import ArtifactReadContext, published_snapshot, serialize_artifact
from plane.utils.access_policy import WorkspaceAccessPolicy, get_workspace_access_policy


class SummaryObserverReadTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        cls.user = User.objects.create(email="summary-observer@example.invalid", username="summary-observer")
        cls.guest = User.objects.create(email="summary-guest@example.invalid", username="summary-guest")
        cls.owner = User.objects.create(email="summary-owner@example.invalid", username="summary-owner")
        cls.workspace = Workspace.objects.create(name="Summary QA", slug="summary-qa", owner=cls.owner)
        WorkspaceMember.objects.create(workspace=cls.workspace, member=cls.owner, role=20)
        cls.observer_membership = WorkspaceMember.objects.create(
            workspace=cls.workspace, member=cls.user, role=5, access_profile="summary_observer",
        )
        WorkspaceMember.objects.create(workspace=cls.workspace, member=cls.guest, role=5)
        cls.project = Project.objects.create(name="Allowed", identifier="ALW", workspace=cls.workspace)
        cls.other_project = Project.objects.create(name="Denied", identifier="DEN", workspace=cls.workspace)
        cls.project.guest_view_all_features = True
        cls.project.save(update_fields=["guest_view_all_features"])
        for member, projects in ((cls.user, (cls.project, cls.other_project)), (cls.guest, (cls.project,))):
            for project in projects:
                ProjectMember.objects.create(project=project, workspace=cls.workspace, member=member, role=5)
        cls.view = IssueView.objects.create(
            workspace=cls.workspace, project=cls.project, owned_by=cls.owner,
            name="Saved window", filters={"name": "Window"},
            rich_filters={}, display_filters={"layout": "list", "order_by": "name", "group_by": "state_id"},
        )
        cls.other_view = IssueView.objects.create(
            workspace=cls.workspace, project=cls.other_project, owned_by=cls.owner,
            name="Private example", filters={},
        )
        cls.ungranted_view = IssueView.objects.create(
            workspace=cls.workspace, project=cls.project, owned_by=cls.owner,
            name="Unshared view", filters={}, access=0,
        )
        WorkspaceMemberProjectGrant.objects.create(workspace_member=cls.observer_membership, project=cls.project)
        WorkspaceMemberViewGrant.objects.create(workspace_member=cls.observer_membership, view=cls.view)
        # A view can be view-granted while its project is not; policy must still
        # deny access to its rows.
        WorkspaceMemberViewGrant.objects.create(workspace_member=cls.observer_membership, view=cls.other_view)
        cls.parent = Issue.objects.create(project=cls.project, name="Window parent", description_html="<p>private description</p>")
        cls.child = Issue.objects.create(project=cls.project, name="Window child", parent=cls.parent)
        cls.filtered_out = Issue.objects.create(project=cls.project, name="Excluded by saved view")
        cls.other_issue = Issue.objects.create(project=cls.other_project, name="Window outside project")
        cls.observer_policy = get_workspace_access_policy(SimpleNamespace(user=cls.user), cls.workspace.slug)

    def test_view_made_private_revokes_existing_grant(self):
        self.view.access = 0
        self.view.save(update_fields=["access"])
        request = APIRequestFactory().get("/summary/views/work-items/")
        force_authenticate(request, user=self.user)
        response = SummaryViewWorkItemsEndpoint.as_view()(request, slug=self.workspace.slug, view_id=self.view.id)
        self.assertEqual(response.status_code, 403)

    def test_only_explicitly_granted_view_metadata_is_returned(self):
        request = APIRequestFactory().get("/summary/views/")
        force_authenticate(request, user=self.user)
        response = SummaryViewListEndpoint.as_view()(request, slug=self.workspace.slug)
        self.assertEqual(response.status_code, 200)
        self.assertEqual([item["id"] for item in response.data["results"]], [str(self.view.id)])
        self.assertNotIn("filters", response.data["results"][0])
        self.assertEqual(response.data["results"][0]["display_filters"], {"layout": "list", "order_by": "name", "group_by": "state_id"})

    def test_saved_filter_is_authoritative_and_projection_ignores_detail_expansion(self):
        request = APIRequestFactory().get(
            "/summary/views/work-items/?fields=description_html&expand=description&filters=%7B%7D&project=" + str(self.other_project.id)
        )
        force_authenticate(request, user=self.user)
        response = SummaryViewWorkItemsEndpoint.as_view()(request, slug=self.workspace.slug, view_id=self.view.id)
        self.assertEqual(response.status_code, 200, response.data)
        rows = response.data["results"]
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["id"], str(self.parent.id))
        self.assertEqual(rows[0]["children"][0]["id"], str(self.child.id))
        self.assertEqual(response.data["hierarchy_scope"], "view_results")
        allowed_fields = {"id", "project_id", "identifier", "name", "state", "assignees", "priority", "start_date", "target_date", "parent_id", "child_count", "children", "context_only"}
        self.assertEqual(set(rows[0]), allowed_fields)
        self.assertNotIn("description_html", rows[0])
        self.assertNotIn(str(self.filtered_out.id), str(response.data))
        self.assertNotIn(str(self.other_issue.id), str(response.data))

    def test_ungranted_view_is_denied_even_when_identifier_is_known(self):
        request = APIRequestFactory().get("/summary/views/work-items/")
        force_authenticate(request, user=self.user)
        response = SummaryViewWorkItemsEndpoint.as_view()(request, slug=self.workspace.slug, view_id=self.ungranted_view.id)
        self.assertEqual(response.status_code, 403)

    def test_view_grant_cannot_cross_its_ungranted_project(self):
        request = APIRequestFactory().get("/summary/views/work-items/")
        force_authenticate(request, user=self.user)
        response = SummaryViewWorkItemsEndpoint.as_view()(request, slug=self.workspace.slug, view_id=self.other_view.id)
        self.assertEqual(response.status_code, 403)

    def test_standard_guest_keeps_project_member_visibility(self):
        list_request = APIRequestFactory().get("/summary/views/")
        force_authenticate(list_request, user=self.guest)
        listed = SummaryViewListEndpoint.as_view()(list_request, slug=self.workspace.slug)
        self.assertEqual(listed.status_code, 200, listed.data)
        self.assertIn(str(self.view.id), {item["id"] for item in listed.data["results"]})

        request = APIRequestFactory().get("/summary/views/work-items/")
        force_authenticate(request, user=self.guest)
        response = SummaryViewWorkItemsEndpoint.as_view()(request, slug=self.workspace.slug, view_id=self.view.id)
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data["count"], 2)
        denied_request = APIRequestFactory().get("/summary/views/work-items/")
        force_authenticate(denied_request, user=self.guest)
        denied_scope = SummaryViewWorkItemsEndpoint.as_view()(denied_request, slug=self.workspace.slug, view_id=self.other_view.id)
        self.assertEqual(denied_scope.status_code, 404, denied_scope.data)

    def test_published_artifact_is_scoped_and_withdrawn_snapshot_is_unavailable(self):
        artifact = Artifact.objects.create(
            workspace=self.workspace, owner=self.owner, title="Published", kind="guide",
            access=Artifact.Access.WORKSPACE, status=Artifact.Status.PUBLISHED,
        )
        revision = ArtifactRevision.objects.create(
            artifact=artifact, number=1,
            snapshot={
                "title": "Published",
                "sources": [{"id": str(self.parent.id), "project_id": str(self.project.id)}],
                "materials": [],
                "assignee_ids": [str(self.guest.id)],
            },
        )
        artifact.published_revision = revision
        artifact.save(update_fields=["published_revision"])
        context = ArtifactReadContext(self.user, self.workspace, [artifact], role=5, policy=self.observer_policy)
        self.assertEqual(published_snapshot(artifact, self.user, read_context=context)["title"], "Published")
        projection = serialize_artifact(artifact, self.user, read_context=context)
        self.assertEqual(projection["assignee_ids"], [str(self.guest.id)])
        self.assertEqual(len(projection["assignees"]), 1)
        self.assertEqual(projection["assignees"][0]["id"], str(self.guest.id))
        self.assertEqual(set(projection["assignees"][0]), {"id", "display_name", "avatar_url"})
        self.assertNotIn("email", projection["assignees"][0])

        published_only = WorkspaceAccessPolicy(
            profile="summary_observer", capabilities=frozenset({"artifact.published.read"}),
            allowed_project_ids=frozenset({str(self.project.id)}),
            allowed_view_ids=frozenset({str(self.view.id)}), workspace_id=str(self.workspace.id),
        )
        restricted_context = ArtifactReadContext(self.user, self.workspace, [artifact], role=5, policy=published_only)
        with self.assertRaises(PermissionDenied):
            restricted_context.authorize_snapshot(revision.snapshot)

        artifact.status = Artifact.Status.WITHDRAWN
        artifact.save(update_fields=["status"])
        with self.assertRaises(NotFound):
            published_snapshot(artifact, self.user, read_context=context)
