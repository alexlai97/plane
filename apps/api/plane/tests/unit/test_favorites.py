from django.db import connection
from django.test import TestCase
from django.test.utils import CaptureQueriesContext
from rest_framework.request import Request
from rest_framework.test import APIRequestFactory, force_authenticate

from plane.app.serializers.favorite import UserFavoriteSerializer
from plane.app.services.favorites import resolve_favorite_targets
from plane.app.views.workspace.favorite import WorkspaceFavoriteEndpoint
from plane.db.models import (
    Artifact, ArtifactRevision, Issue, IssueView, Project, ProjectMember, User, UserFavorite, Workspace, WorkspaceMember,
)


class UnifiedFavoriteTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        cls.owner = User.objects.create(email="favorites-owner@example.invalid", username="favorites-owner")
        cls.member = User.objects.create(email="favorites-member@example.invalid", username="favorites-member")
        cls.workspace = Workspace.objects.create(name="Favorites QA", slug="favorites-qa", owner=cls.owner)
        WorkspaceMember.objects.create(workspace=cls.workspace, member=cls.owner, role=20)
        WorkspaceMember.objects.create(workspace=cls.workspace, member=cls.member, role=15)
        cls.visible = Project.objects.create(name="Visible project", identifier="VIS", workspace=cls.workspace)
        cls.hidden = Project.objects.create(name="Hidden project", identifier="HID", workspace=cls.workspace)
        ProjectMember.objects.create(project=cls.visible, workspace=cls.workspace, member=cls.owner, role=20)
        ProjectMember.objects.create(project=cls.visible, workspace=cls.workspace, member=cls.member, role=15)
        ProjectMember.objects.create(project=cls.hidden, workspace=cls.workspace, member=cls.owner, role=20)
        cls.issue = Issue.objects.create(project=cls.visible, name="Readable child")
        cls.issue_child = Issue.objects.create(project=cls.visible, name="Readable nested child", parent=cls.issue)
        cls.private_issue = Issue.objects.create(project=cls.hidden, name="Private title")
        cls.other_workspace = Workspace.objects.create(name="Other", slug="favorites-other", owner=cls.owner)
        WorkspaceMember.objects.create(workspace=cls.other_workspace, member=cls.owner, role=20)
        cls.outside_project = Project.objects.create(name="Outside", identifier="OUT", workspace=cls.other_workspace)
        ProjectMember.objects.create(project=cls.outside_project, workspace=cls.other_workspace, member=cls.owner, role=20)

    def favorite(self, entity_type, entity):
        return UserFavorite.objects.create(
            workspace=self.workspace,
            project=entity.project,
            user=self.member,
            entity_type=entity_type,
            entity_identifier=entity.id,
        )

    def endpoint(self, method, user, data=None, favorite_id=None):
        factory = APIRequestFactory()
        path = f"/api/workspaces/{self.workspace.slug}/user-favorites/"
        if favorite_id:
            path += f"{favorite_id}/"
        request = getattr(factory, method)(path, data or {}, format="json")
        force_authenticate(request, user=user)
        kwargs = {"slug": self.workspace.slug}
        if favorite_id:
            kwargs["favorite_id"] = favorite_id
        return WorkspaceFavoriteEndpoint.as_view()(request, **kwargs)

    def test_issue_and_nested_issue_metadata_resolve_but_private_titles_do_not(self):
        parent = self.favorite("issue", self.issue)
        child = self.favorite("issue", self.issue_child)
        hidden = self.favorite("issue", self.private_issue)

        resolved = resolve_favorite_targets([parent, child, hidden], self.member)

        for favorite in (parent, child):
            self.assertTrue(resolved[favorite.id]["is_available"])
            self.assertEqual(
                resolved[favorite.id]["entity_data"]["identifier"],
                f"VIS-{self.issue.sequence_id if favorite == parent else self.issue_child.sequence_id}",
            )
            self.assertEqual(resolved[favorite.id]["entity_data"]["project_identifier"], "VIS")
            self.assertEqual(resolved[favorite.id]["entity_data"]["project_id"], str(self.visible.id))
        self.assertEqual(resolved[child.id]["entity_data"]["name"], "Readable nested child")
        self.assertFalse(resolved[hidden.id]["is_available"])
        self.assertIsNone(resolved[hidden.id]["entity_data"])

        request = Request(APIRequestFactory().get("/api/workspaces/favorites-qa/user-favorites/"))
        request.user = self.member
        payload = UserFavoriteSerializer(
            [parent, child, hidden], many=True, context={"request": request, "workspace": self.workspace}
        ).data
        self.assertEqual(payload[0]["entity_data"]["name"], "Readable child")
        self.assertTrue(payload[1]["is_available"])
        self.assertFalse(payload[2]["is_available"])
        self.assertIsNone(payload[2]["entity_data"])
        self.assertIsNone(payload[2]["name"])

    def test_serializer_rejects_cross_project_target_and_foreign_parent_folder(self):
        factory = APIRequestFactory()
        request = Request(factory.post("/", {}, format="json"))
        request.user = self.member
        serializer = UserFavoriteSerializer(
            data={"entity_type": "issue", "entity_identifier": str(self.private_issue.id)},
            context={"request": request, "workspace": self.workspace},
        )
        self.assertFalse(serializer.is_valid())
        self.assertIn("entity_identifier", serializer.errors)

        foreign_folder = UserFavorite.objects.create(
            workspace=self.workspace, user=self.owner, entity_type="folder", is_folder=True, name="private folder"
        )
        serializer = UserFavoriteSerializer(
            data={"entity_type": "issue", "entity_identifier": str(self.issue.id), "parent": str(foreign_folder.id)},
            context={"request": request, "workspace": self.workspace},
        )
        self.assertFalse(serializer.is_valid())
        self.assertIn("parent", serializer.errors)

        serializer = UserFavoriteSerializer(
            data={"entity_type": "issue", "entity_identifier": str(self.issue.id), "project_id": str(self.outside_project.id)},
            context={"request": request, "workspace": self.workspace},
        )
        self.assertFalse(serializer.is_valid())
        self.assertIn("entity_identifier", serializer.errors)

        serializer = UserFavoriteSerializer(
            data={"entity_type": "issue", "is_folder": True},
            context={"request": request, "workspace": self.workspace},
        )
        self.assertFalse(serializer.is_valid())
        self.assertIn("entity_type", serializer.errors)

    def test_endpoint_create_is_idempotent_identity_is_immutable_and_unavailable_favorites_remain_removable(self):
        payload = {
            "entity_type": "issue", "entity_identifier": str(self.issue.id), "project_id": str(self.visible.id),
        }
        created = self.endpoint("post", self.member, payload)
        self.assertEqual(created.status_code, 200, created.data)
        favorite_id = created.data["id"]
        self.assertTrue(created.data["is_available"])
        repeated = self.endpoint("post", self.member, payload)
        self.assertEqual(repeated.data["id"], favorite_id)

        changed = self.endpoint("patch", self.member, {"entity_identifier": str(self.issue_child.id)}, favorite_id)
        self.assertEqual(changed.status_code, 400)
        self.assertEqual(UserFavorite.objects.get(id=favorite_id).entity_identifier, self.issue.id)

        ProjectMember.objects.filter(project=self.visible, member=self.member).update(is_active=False)
        listing = self.endpoint("get", self.member)
        row = next(item for item in listing.data if item["id"] == favorite_id)
        self.assertFalse(row["is_available"])
        self.assertIsNone(row["entity_data"])
        self.assertIsNone(row["name"])
        reorder_unavailable = self.endpoint("patch", self.member, {"sequence": 12345.0}, favorite_id)
        self.assertEqual(reorder_unavailable.status_code, 200, reorder_unavailable.data)
        deleted = self.endpoint("delete", self.member, favorite_id=favorite_id)
        self.assertEqual(deleted.status_code, 204)
        self.assertFalse(UserFavorite.objects.filter(id=favorite_id).exists())

    def test_folder_reparent_requires_same_users_folder(self):
        own = UserFavorite.objects.create(workspace=self.workspace, user=self.member, entity_type="folder", is_folder=True, name="Own")
        foreign = UserFavorite.objects.create(workspace=self.workspace, user=self.owner, entity_type="folder", is_folder=True, name="Other user")
        target = self.favorite("issue", self.issue)
        accepted = self.endpoint("patch", self.member, {"parent": str(own.id)}, target.id)
        self.assertEqual(accepted.status_code, 200, accepted.data)
        denied = self.endpoint("patch", self.member, {"parent": str(foreign.id)}, target.id)
        self.assertEqual(denied.status_code, 400)
        self.assertEqual(UserFavorite.objects.get(id=target.id).parent_id, own.id)

        nested_folder = self.endpoint("patch", self.member, {"parent": str(own.id)}, own.id)
        self.assertEqual(nested_folder.status_code, 400)
        folder_kind_change = self.endpoint("patch", self.member, {"is_folder": False}, own.id)
        self.assertEqual(folder_kind_change.status_code, 400)

    def test_folder_name_is_writable_on_create_rename_and_read(self):
        too_long = self.endpoint(
            "post", self.member,
            {"entity_type": "folder", "is_folder": True, "name": "x" * 256},
        )
        self.assertEqual(too_long.status_code, 400)

        created = self.endpoint(
            "post", self.member,
            {"entity_type": "folder", "is_folder": True, "name": "验收资料"},
        )
        self.assertEqual(created.status_code, 200, created.data)
        folder_id = created.data["id"]
        self.assertEqual(created.data["name"], "验收资料")
        self.assertEqual(UserFavorite.objects.get(id=folder_id).name, "验收资料")

        renamed = self.endpoint("patch", self.member, {"name": "归档资料"}, folder_id)
        self.assertEqual(renamed.status_code, 200, renamed.data)
        self.assertEqual(renamed.data["name"], "归档资料")
        self.assertEqual(UserFavorite.objects.get(id=folder_id).name, "归档资料")
        listed = self.endpoint("get", self.member)
        saved = next(item for item in listed.data if item["id"] == folder_id)
        self.assertEqual(saved["name"], "归档资料")

    def test_workspace_view_public_private_and_artifact_publication_visibility(self):
        public_view = IssueView.objects.create(
            workspace=self.workspace, owned_by=self.owner, name="Public view", access=1, filters={},
        )
        private_view = IssueView.objects.create(
            workspace=self.workspace, owned_by=self.owner, name="Private view", access=0, filters={},
        )
        public_favorite = UserFavorite.objects.create(
            workspace=self.workspace, user=self.member, entity_type="workspace_view", entity_identifier=public_view.id,
        )
        private_favorite = UserFavorite.objects.create(
            workspace=self.workspace, user=self.member, entity_type="workspace_view", entity_identifier=private_view.id,
        )

        artifact = Artifact.objects.create(
            workspace=self.workspace, owner=self.owner, title="Published artifact", kind="guide", access="workspace",
            status=Artifact.Status.PUBLISHED,
        )
        revision = ArtifactRevision.objects.create(artifact=artifact, number=1, snapshot={"title": "Published artifact"})
        artifact.published_revision = revision
        artifact.save(update_fields=["published_revision"])
        artifact_favorite = UserFavorite.objects.create(
            workspace=self.workspace, user=self.member, entity_type="artifact", entity_identifier=artifact.id,
        )

        resolved = resolve_favorite_targets([public_favorite, private_favorite, artifact_favorite], self.member)
        self.assertTrue(resolved[public_favorite.id]["is_available"])
        self.assertFalse(resolved[private_favorite.id]["is_available"])
        self.assertTrue(resolved[artifact_favorite.id]["is_available"])

        artifact.status = Artifact.Status.WITHDRAWN
        artifact.save(update_fields=["status"])
        withdrawn = resolve_favorite_targets([artifact_favorite], self.member)
        self.assertFalse(withdrawn[artifact_favorite.id]["is_available"])
        self.assertIsNone(withdrawn[artifact_favorite.id]["entity_data"])

    def test_guest_issue_policy_and_collection_query_count_are_bounded(self):
        own_issue = Issue.objects.create(project=self.visible, name="Guest own", created_by=self.member)
        # AuditModel clears created_by when no request user is active in this unit test.
        Issue.objects.filter(id=own_issue.id).update(created_by_id=self.member.id)
        ProjectMember.objects.filter(project=self.visible, member=self.member).update(role=5)
        self.visible.guest_view_all_features = False
        self.visible.save(update_fields=["guest_view_all_features"])
        own_favorite = self.favorite("issue", own_issue)
        other_favorite = self.favorite("issue", self.issue)
        resolved = resolve_favorite_targets([own_favorite, other_favorite], self.member)
        self.assertTrue(resolved[own_favorite.id]["is_available"])
        self.assertFalse(resolved[other_favorite.id]["is_available"])

        small = [other_favorite]
        small_artifact = Artifact.objects.create(
            workspace=self.workspace, owner=self.owner, title="Batch artifact", kind="guide", access="workspace",
            status=Artifact.Status.PUBLISHED,
        )
        small_revision = ArtifactRevision.objects.create(artifact=small_artifact, number=1, snapshot={"title": "Batch artifact"})
        small_artifact.published_revision = small_revision
        small_artifact.save(update_fields=["published_revision"])
        small.append(UserFavorite.objects.create(
            workspace=self.workspace, user=self.member, entity_type="artifact", entity_identifier=small_artifact.id,
        ))
        small_view = IssueView.objects.create(
            workspace=self.workspace, owned_by=self.owner, name="Batch view", access=1, filters={},
        )
        small.append(UserFavorite.objects.create(
            workspace=self.workspace, user=self.member, entity_type="workspace_view", entity_identifier=small_view.id,
        ))
        many_issues = [Issue.objects.create(project=self.visible, name=f"batch {index}") for index in range(12)]
        large = [self.favorite("issue", issue) for issue in many_issues]
        for index in range(12):
            artifact = Artifact.objects.create(
                workspace=self.workspace, owner=self.owner, title=f"Batch artifact {index}", kind="guide",
                access="workspace", status=Artifact.Status.PUBLISHED,
            )
            revision = ArtifactRevision.objects.create(
                artifact=artifact, number=1, snapshot={"title": artifact.title},
            )
            artifact.published_revision = revision
            artifact.save(update_fields=["published_revision"])
            large.append(UserFavorite.objects.create(
                workspace=self.workspace, user=self.member, entity_type="artifact", entity_identifier=artifact.id,
            ))
            view = IssueView.objects.create(
                workspace=self.workspace, owned_by=self.owner, name=f"Batch view {index}", access=1, filters={},
            )
            large.append(UserFavorite.objects.create(
                workspace=self.workspace, user=self.member, entity_type="workspace_view", entity_identifier=view.id,
            ))
        with CaptureQueriesContext(connection) as small_queries:
            resolve_favorite_targets(small, self.member)
        with CaptureQueriesContext(connection) as large_queries:
            resolve_favorite_targets(large, self.member)
        self.assertEqual(len(small_queries), len(large_queries))
