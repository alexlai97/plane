"""Artifact lifecycle and authorization contracts for the Django test runner."""
import json
import base64
import tempfile
import uuid
from urllib.parse import unquote, urlparse
from pathlib import Path

from django.core.management import call_command, CommandError
from django.test import TestCase, override_settings
from django.db import connection
from django.test.utils import CaptureQueriesContext
from django.core.files.uploadedfile import SimpleUploadedFile
from django.core import signing
from django.http import HttpResponse
from unittest.mock import Mock, patch
from rest_framework.test import APIClient, APIRequestFactory, force_authenticate

from plane.app.views.artifact import ArtifactEndpoint
from plane.app.views.artifact import ArtifactUploadEndpoint
from plane.app.views.gallery import WorkspaceGalleryEndpoint
from plane.app.views.attachment_preview import ArtifactPreviewSourceEndpoint, ARTIFACT_SOURCE_SALT, is_previewable_asset
from plane.db.models import (
    Artifact, ArtifactCategory, ArtifactRevision, FileAsset, Issue, Project,
    APIToken, ProjectMember, User, Workspace, WorkspaceMember,
)


class ArtifactLifecycleTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        cls.owner = User.objects.create(email="artifact-owner@example.invalid", username="artifact-owner")
        cls.member = User.objects.create(email="artifact-member@example.invalid", username="artifact-member")
        cls.unassigned_admin = User.objects.create(email="artifact-admin@example.invalid", username="artifact-admin")
        cls.stranger = User.objects.create(email="artifact-stranger@example.invalid", username="artifact-stranger")
        cls.workspace = Workspace.objects.create(name="Artifacts QA", slug="artifacts-qa", owner=cls.owner)
        cls.other_workspace = Workspace.objects.create(name="Other QA", slug="other-artifacts-qa", owner=cls.stranger)
        WorkspaceMember.objects.create(workspace=cls.workspace, member=cls.owner, role=20)
        WorkspaceMember.objects.create(workspace=cls.workspace, member=cls.member, role=15)
        WorkspaceMember.objects.create(workspace=cls.workspace, member=cls.unassigned_admin, role=20)
        WorkspaceMember.objects.create(workspace=cls.other_workspace, member=cls.stranger, role=20)
        cls.project = Project.objects.create(name="Visible", identifier="VIS", workspace=cls.workspace)
        cls.private_project = Project.objects.create(name="Private", identifier="PRV", workspace=cls.workspace)
        ProjectMember.objects.create(project=cls.project, workspace=cls.workspace, member=cls.owner, role=20)
        ProjectMember.objects.create(project=cls.project, workspace=cls.workspace, member=cls.member, role=15)
        ProjectMember.objects.create(project=cls.private_project, workspace=cls.workspace, member=cls.owner, role=20)
        cls.issue = Issue.objects.create(project=cls.project, name="可见任务")
        cls.private_issue = Issue.objects.create(project=cls.private_project, name="私有任务")

    def request(self, method, user, data=None, pk=None, action=None, query=None):
        factory = APIRequestFactory()
        path = "/api/workspaces/artifacts-qa/artifacts/"
        if pk:
            path += f"{pk}/"
        if action:
            path += f"{action}/"
        if method == "get" and query:
            path += "?" + query
        request = getattr(factory, method)(path, data or {}, format="json")
        if user:
            force_authenticate(request, user=user)
        kwargs = {"slug": "artifacts-qa"}
        if pk:
            kwargs["pk"] = pk
        if action:
            kwargs["action"] = action
        return ArtifactEndpoint.as_view()(request, **kwargs)

    @staticmethod
    def payload(**updates):
        base = {
            "title": "成果", "summary": "简介", "kind": "系统", "source_issue_ids": [], "assets": [],
            "links": [{"title": "演示", "url": "https://example.invalid/demo", "kind": "demo"}],
            "primary_action": {"type": "link", "label": "查看演示", "url": "https://example.invalid/demo"},
        }
        return {**base, **updates}

    def test_draft_publication_isolation_optimistic_lock_withdraw_and_restore(self):
        created = self.request("post", self.owner, self.payload())
        self.assertEqual(created.status_code, 201, created.data)
        artifact_id = created.data["id"]
        self.assertEqual(self.request("get", self.member).data["count"], 0)
        self.assertEqual(self.request("patch", self.owner, self.payload(summary="no version"), artifact_id).status_code, 400)
        updated = self.request("patch", self.owner, self.payload(summary="saved", version=1), artifact_id)
        self.assertEqual(updated.status_code, 200, updated.data)
        self.assertEqual(updated.data["version"], 2)
        self.assertEqual(self.request("patch", self.owner, self.payload(version=1), artifact_id).status_code, 409)
        published = self.request("post", self.owner, {"version": 2}, artifact_id, "publish")
        self.assertEqual(published.status_code, 200, published.data)
        artifact = Artifact.objects.get(id=artifact_id)
        published_revision = artifact.published_revision_id
        edited = self.request("patch", self.owner, self.payload(summary="later draft", version=3), artifact_id)
        self.assertEqual(edited.status_code, 200)
        public = self.request("get", self.member, pk=artifact_id)
        self.assertEqual(public.status_code, 200)
        self.assertEqual(public.data["summary"], "saved")
        self.assertTrue(public.data["has_unpublished_changes"])
        self.assertEqual(self.request("get", self.owner, pk=artifact_id, query="view=draft").data["summary"], "later draft")
        self.assertEqual(self.request("get", self.stranger, pk=artifact_id).status_code, 404)
        withdrawn = self.request("post", self.owner, {"version": 4}, artifact_id, "withdraw")
        self.assertEqual(withdrawn.status_code, 200)
        self.assertEqual(self.request("get", self.member).data["count"], 0)
        # Restore is draft-only and cannot republish implicitly.
        restored_request = APIRequestFactory().post(f"/api/workspaces/artifacts-qa/artifacts/{artifact_id}/revisions/{published_revision}/restore/", {"version": 5}, format="json")
        force_authenticate(restored_request, user=self.owner)
        restored = ArtifactEndpoint.as_view()(restored_request, slug="artifacts-qa", pk=artifact_id, action="restore", revision_id=published_revision)
        self.assertEqual(restored.status_code, 200, restored.data)
        self.assertEqual(restored.data["status"], Artifact.Status.WITHDRAWN)
        self.assertEqual(self.request("get", self.member).data["count"], 0)

    def revision_request(self, user, artifact_id, revision_id=None):
        from plane.app.views.artifact import ArtifactRevisionEndpoint
        request = APIRequestFactory().get("/revisions/")
        force_authenticate(request, user=user)
        return ArtifactRevisionEndpoint.as_view()(request, slug=self.workspace.slug, pk=artifact_id, revision_id=revision_id)

    def test_historical_sources_are_authorized_independently_of_current_draft(self):
        created = self.request("post", self.owner, self.payload(source_issue_ids=[str(self.private_issue.id)]))
        artifact_id = created.data["id"]
        self.request("post", self.owner, {"version": 1}, artifact_id, "publish")
        revision_id = Artifact.objects.get(id=artifact_id).published_revision_id
        self.request("patch", self.owner, self.payload(version=2), artifact_id)
        self.request("post", self.owner, {"version": 3}, artifact_id, "publish")
        for user in (self.member, self.unassigned_admin):
            self.assertEqual(self.revision_request(user, artifact_id, revision_id).status_code, 404)
            history = self.revision_request(user, artifact_id)
            self.assertEqual(history.status_code, 200)
            self.assertEqual(len(history.data["results"]), 1)
            denied = self.request("post", user, {"version": 4, "revision_id": str(revision_id)}, artifact_id, "restore")
            self.assertGreaterEqual(denied.status_code, 400)
            self.assertEqual(Artifact.objects.get(id=artifact_id).version, 4)
        self.assertEqual(self.revision_request(self.owner, artifact_id, revision_id).status_code, 200)
        # Old revisions do not permanently prevent editing an accessible current publication.
        self.assertEqual(self.request("patch", self.member, {"version": 4, "summary": "allowed"}, artifact_id).status_code, 200)

    def test_existing_private_sources_protect_clear_withdraw_delete_and_deleted_metadata(self):
        from django.utils import timezone
        for deletion in ("active", "soft", "hard"):
            issue = Issue.objects.create(project=self.private_project, name="受保护任务")
            created = self.request("post", self.owner, self.payload(source_issue_ids=[str(issue.id)]))
            artifact_id = created.data["id"]
            self.request("post", self.owner, {"version": 1}, artifact_id, "publish")
            artifact = Artifact.objects.get(id=artifact_id)
            revision_id = artifact.published_revision_id
            gallery_request = APIRequestFactory().get("/gallery/")
            force_authenticate(gallery_request, user=self.member)
            gallery = WorkspaceGalleryEndpoint.as_view()(gallery_request, slug=self.workspace.slug)
            self.assertEqual(gallery.status_code, 200, gallery.data)
            self.assertNotIn(artifact_id, {item["id"] for item in gallery.data["cards"]})
            if deletion == "soft":
                Issue.all_objects.filter(id=issue.id).update(deleted_at=timezone.now())
            elif deletion == "hard":
                Issue.all_objects.filter(id=issue.id).delete()
            for user in (self.member, self.unassigned_admin):
                self.assertEqual(self.request("get", user, pk=artifact_id).status_code, 404)
                self.assertEqual(self.revision_request(user, artifact_id, revision_id).status_code, 404)
                self.assertEqual(self.revision_request(user, artifact_id).data["results"], [])
                operations = [
                    ("patch", self.payload(version=2), None),
                    ("patch", {"version": 2, "source_issue_ids": [], "assets": [], "links": [], "primary_action": {"type": "detail", "label": "详情"}}, None),
                    ("post", {"version": 2}, "withdraw"),
                    ("delete", {"version": 2}, None),
                ]
                before = (artifact.summary, artifact.sources.count(), artifact.materials.count(), revision_id)
                for method, body, action in operations:
                    self.assertEqual(self.request(method, user, body, artifact_id, action).status_code, 403)
                    artifact.refresh_from_db()
                    self.assertEqual(artifact.version, 2)
                    self.assertEqual(artifact.status, Artifact.Status.PUBLISHED)
                    self.assertIsNone(artifact.deleted_at)
                    self.assertEqual((artifact.summary, artifact.sources.count(), artifact.materials.count(), artifact.published_revision_id), before)
            allowed = self.request("get", self.owner, pk=artifact_id)
            self.assertEqual(allowed.status_code, 200, allowed.data)
            self.assertEqual(allowed.data["unavailable_reference_count"], int(deletion != "active"))
            self.assertEqual(self.revision_request(self.owner, artifact_id, revision_id).status_code, 200)
            self.assertEqual(self.request("patch", self.owner, self.payload(version=2), artifact_id).status_code, 200)
            self.assertEqual(self.request("post", self.owner, {"version": 3}, artifact_id, "withdraw").status_code, 200)
            self.assertEqual(self.request("delete", self.owner, {"version": 4}, artifact_id).status_code, 204)

    def test_current_publication_protects_replaced_draft_and_unknown_deleted_scope_denies(self):
        created = self.request("post", self.owner, self.payload(source_issue_ids=[str(self.private_issue.id)]))
        artifact_id = created.data["id"]
        self.request("post", self.owner, {"version": 1}, artifact_id, "publish")
        self.assertEqual(self.request("patch", self.owner, self.payload(version=2), artifact_id).status_code, 200)
        for user in (self.member, self.unassigned_admin):
            self.assertEqual(self.request("patch", user, self.payload(version=3), artifact_id).status_code, 403)
            self.assertEqual(self.request("post", user, {"version": 3}, artifact_id, "withdraw").status_code, 403)
            self.assertEqual(self.request("delete", user, {"version": 3}, artifact_id).status_code, 403)
        artifact = Artifact.objects.get(id=artifact_id)
        self.assertEqual(artifact.version, 3)
        revision = artifact.published_revision
        revision.snapshot["sources"] = [{"id": str(uuid.uuid4()), "name": "unknown private"}]
        revision.save(update_fields=["snapshot"])
        self.assertEqual(self.request("get", self.owner, pk=artifact_id).status_code, 404)
        self.assertEqual(self.revision_request(self.owner, artifact_id, revision.id).status_code, 404)
        self.assertEqual(self.request("patch", self.owner, self.payload(version=3), artifact_id).status_code, 403)
        self.assertEqual(Artifact.objects.get(id=artifact_id).version, 3)

    def test_null_draft_source_retains_its_own_scope_independent_of_publication(self):
        from plane.db.models import ArtifactSource
        created = self.request("post", self.owner, self.payload(source_issue_ids=[str(self.issue.id)]))
        artifact_id = created.data["id"]
        self.request("post", self.owner, {"version": 1}, artifact_id, "publish")
        private = Issue.objects.create(project=self.private_project, name="unpublished private source")
        self.assertEqual(self.request("patch", self.owner, self.payload(version=2, source_issue_ids=[str(private.id)]), artifact_id).status_code, 200)
        source = ArtifactSource.objects.get(artifact_id=artifact_id)
        self.assertEqual(source.project_id, self.private_project.id)
        Issue.all_objects.filter(id=private.id).delete()
        source.refresh_from_db()
        self.assertIsNone(source.issue_id)
        self.assertEqual(source.project_id, self.private_project.id)
        for user in (self.member, self.unassigned_admin):
            self.assertEqual(self.request("get", user, pk=artifact_id, query="view=draft").status_code, 404)
            public = self.request("get", user, pk=artifact_id)
            if user == self.member:
                self.assertEqual(public.status_code, 200)
                self.assertFalse(public.data["can_edit"])
            for method, body, action in [
                ("patch", self.payload(version=3), None),
                ("post", {"version": 3}, "withdraw"),
                ("delete", {"version": 3}, None),
            ]:
                self.assertEqual(self.request(method, user, body, artifact_id, action).status_code, 403)
                artifact = Artifact.objects.get(id=artifact_id)
                self.assertEqual(artifact.version, 3)
                self.assertEqual(artifact.status, Artifact.Status.PUBLISHED)
                self.assertIsNone(artifact.deleted_at)
                self.assertEqual(artifact.sources.count(), 1)
                self.assertEqual(artifact.sources.get().project_id, self.private_project.id)
        self.assertEqual(self.request("get", self.owner, pk=artifact_id, query="view=draft").data["unavailable_reference_count"], 1)
        self.assertEqual(self.request("patch", self.owner, self.payload(version=3), artifact_id).status_code, 200)
        # An unidentified legacy orphan denies even an owner; never borrow publication A's scope.
        ArtifactSource.objects.create(artifact_id=artifact_id, issue=None, project_id=None)
        self.assertEqual(self.request("get", self.owner, pk=artifact_id, query="view=draft").status_code, 404)
        self.assertEqual(self.request("patch", self.owner, self.payload(version=4), artifact_id).status_code, 403)
        self.assertEqual(Artifact.objects.get(id=artifact_id).version, 4)

    def test_partial_patch_refreshes_retained_source_scope_after_issue_project_move(self):
        from plane.db.models import ArtifactSource
        issue = Issue.objects.create(project=self.project, name="moving source")
        created = self.request("post", self.owner, self.payload(source_issue_ids=[str(issue.id)]))
        artifact_id = created.data["id"]
        self.request("post", self.owner, {"version": 1}, artifact_id, "publish")
        source = ArtifactSource.objects.get(artifact_id=artifact_id)
        original_identity = (source.id, source.created_at)
        Issue.all_objects.filter(id=issue.id).update(project_id=self.private_project.id)
        saved = self.request("patch", self.owner, {"version": 2, "summary": "private moved draft"}, artifact_id)
        self.assertEqual(saved.status_code, 200, saved.data)
        source.refresh_from_db()
        self.assertEqual(source.project_id, self.private_project.id)
        self.assertEqual((source.id, source.created_at), original_identity)
        Issue.all_objects.filter(id=issue.id).delete()
        self.assertEqual(self.request("get", self.member, pk=artifact_id, query="view=draft").status_code, 404)
        for method, body, action in [
            ("patch", self.payload(version=3), None),
            ("post", {"version": 3}, "withdraw"),
            ("delete", {"version": 3}, None),
        ]:
            self.assertEqual(self.request(method, self.member, body, artifact_id, action).status_code, 403)
            artifact = Artifact.objects.get(id=artifact_id)
            self.assertEqual(artifact.version, 3)
            self.assertEqual(artifact.summary, "private moved draft")
            self.assertEqual(artifact.status, Artifact.Status.PUBLISHED)
            self.assertIsNone(artifact.deleted_at)
        self.assertEqual(self.request("get", self.owner, pk=artifact_id, query="view=draft").status_code, 200)

    def test_gallery_order_stays_stable_after_edit_and_management_uses_latest_update(self):
        first = self.request("post", self.owner, self.payload(title="first")).data["id"]
        second = self.request("post", self.owner, self.payload(title="second")).data["id"]
        for artifact_id in (first, second):
            self.assertEqual(self.request("post", self.owner, {"version": 1}, artifact_id, "publish").status_code, 200)

        def gallery_ids():
            request = APIRequestFactory().get("/gallery/")
            force_authenticate(request, user=self.owner)
            response = WorkspaceGalleryEndpoint.as_view()(request, slug=self.workspace.slug)
            self.assertEqual(response.status_code, 200)
            return [row["id"] for row in response.data["cards"]]

        self.assertEqual(gallery_ids(), [first, second])
        self.assertEqual([row["id"] for row in self.request("get", self.owner).data["results"]], [first, second])
        self.assertEqual(self.request("patch", self.owner, {"version": 2, "summary": "new draft"}, first).status_code, 200)
        self.assertEqual(gallery_ids(), [first, second])
        self.assertEqual([row["id"] for row in self.request("get", self.owner).data["results"]], [first, second])
        self.assertEqual([row["id"] for row in self.request("get", self.owner, query="scope=manage").data["results"]], [first, second])
        from django.utils import timezone
        Artifact.objects.filter(id__in=[first, second]).update(updated_at=timezone.now())
        self.assertEqual([row["id"] for row in self.request("get", self.owner, query="scope=manage").data["results"]], sorted([first, second]))

    def test_gallery_collection_query_count_does_not_grow_with_artifact_count(self):
        shared = FileAsset.objects.create(
            workspace=self.workspace, user=self.owner, issue=self.issue, project=self.project,
            entity_type=FileAsset.EntityTypeContext.ISSUE_ATTACHMENT, is_uploaded=True,
            asset="gallery-query-shared.pdf", attributes={"name": "共享材料.pdf", "size": 128, "type": "application/pdf"}, size=128,
        )

        def publish(title):
            created = self.request("post", self.owner, self.payload(
                title=title, source_issue_ids=[str(self.issue.id)], assets=[str(shared.id)],
            ))
            self.assertEqual(created.status_code, 201, created.data)
            self.assertEqual(self.request("post", self.owner, {"version": 1}, created.data["id"], "publish").status_code, 200)
            return created.data["id"]

        first = publish("第一个成果")

        def gallery_query_count():
            request = APIRequestFactory().get("/gallery/")
            force_authenticate(request, user=self.owner)
            with CaptureQueriesContext(connection) as queries:
                response = WorkspaceGalleryEndpoint.as_view()(request, slug=self.workspace.slug)
            self.assertEqual(response.status_code, 200, response.data)
            return len(queries), response.data

        def management_query_count():
            request = APIRequestFactory().get("/artifacts/?scope=manage")
            force_authenticate(request, user=self.owner)
            with CaptureQueriesContext(connection) as queries:
                response = ArtifactEndpoint.as_view()(request, slug=self.workspace.slug)
            self.assertEqual(response.status_code, 200, response.data)
            return len(queries), response.data

        one_count, one = gallery_query_count()
        one_manage_count, _ = management_query_count()
        self.assertTrue(one["can_create"])
        self.assertEqual([item["id"] for item in one["cards"]], [first])
        self.assertEqual(one["cards"][0]["sources"][0]["id"], str(self.issue.id))

        for index in range(3):
            publish(f"第 {index + 2} 个成果")
        four_count, four = gallery_query_count()
        four_manage_count, four_manage = management_query_count()
        self.assertEqual(len(four["cards"]), 4)
        self.assertEqual(four_count, one_count, f"collection query count grew from {one_count} to {four_count}")
        self.assertLessEqual(four_count, 20, f"gallery collection used {four_count} queries for four cards")
        self.assertEqual(len(four_manage["results"]), 4)
        self.assertEqual(four_manage_count, one_manage_count,
                         f"management query count grew from {one_manage_count} to {four_manage_count}")

    def test_gallery_batch_snapshot_matches_single_artifact_serialization_for_frozen_sources(self):
        category = ArtifactCategory.objects.create(workspace=self.workspace, name="产品交付")
        material = FileAsset.objects.create(
            workspace=self.workspace, user=self.owner, issue=self.issue, project=self.project,
            entity_type=FileAsset.EntityTypeContext.ISSUE_ATTACHMENT, is_uploaded=True,
            asset="gallery-parity.pdf", attributes={"name": "交付.pdf", "size": 128, "type": "application/pdf"}, size=128,
        )
        created = self.request("post", self.owner, self.payload(
            category_id=str(category.id), source_issue_ids=[str(self.issue.id)], assets=[str(material.id)],
            primary_action={"type": "attachment", "label": "打开交付", "attachment_id": str(material.id)},
        ))
        artifact_id = created.data["id"]
        self.assertEqual(self.request("patch", self.owner, {
            "version": 1, "cover_asset_id": str(material.id),
        }, artifact_id).status_code, 200)
        self.assertEqual(self.request("post", self.owner, {"version": 2}, artifact_id, "publish").status_code, 200)

        # A deleted source remains readable only through its frozen project reference.
        Issue.all_objects.filter(id=self.issue.id).delete()
        request = APIRequestFactory().get("/gallery/")
        force_authenticate(request, user=self.owner)
        gallery = WorkspaceGalleryEndpoint.as_view()(request, slug=self.workspace.slug)
        self.assertEqual(gallery.status_code, 200, gallery.data)
        card = next(item for item in gallery.data["cards"] if item["id"] == artifact_id)

        from plane.app.services.artifacts import serialize_artifact
        artifact = Artifact.objects.select_related("workspace", "published_revision", "category", "cover_asset", "owner").get(id=artifact_id)
        single = serialize_artifact(artifact, self.owner, "published")
        self.assertEqual(card, single)
        self.assertEqual(card["category"], "产品交付")
        self.assertEqual(card["unavailable_reference_count"], 3)
        self.assertEqual(card["cover"]["asset_id"], str(material.id))
        self.assertEqual(card["attachments"][0]["id"], str(material.id))

    def test_gallery_batch_snapshot_matches_single_serialization_for_foreign_cover_owner(self):
        from plane.app.services.artifacts import serialize_artifact

        published = self.request("post", self.owner, self.payload(title="已发布成果")).data
        self.assertEqual(self.request("post", self.owner, {"version": 1}, published["id"], "publish").status_code, 200)
        other = self.request("post", self.owner, self.payload(title="另一成果")).data
        foreign_asset = FileAsset.objects.create(
            workspace=self.workspace, user=self.owner, entity_type=FileAsset.EntityTypeContext.ARTIFACT_ATTACHMENT,
            entity_identifier=other["id"], is_uploaded=True, asset="foreign-cover.png",
            attributes={"name": "另一成果封面.png", "size": 64, "type": "image/png"}, size=64,
        )
        artifact = Artifact.objects.get(id=published["id"])
        revision = artifact.published_revision
        snapshot_data = dict(revision.snapshot)
        reference = {"title": "跨成果附件", "url": None, "kind": "attachment", "asset_id": str(foreign_asset.id),
                     "name": "另一成果封面.png", "size": 64, "mime": "image/png"}
        snapshot_data["materials"] = [*snapshot_data.get("materials", []), reference]
        snapshot_data["cover"] = {"asset_id": str(foreign_asset.id), "name": "另一成果封面.png"}
        revision.snapshot = snapshot_data
        revision.save(update_fields=["snapshot"])

        request = APIRequestFactory().get("/gallery/")
        force_authenticate(request, user=self.owner)
        gallery = WorkspaceGalleryEndpoint.as_view()(request, slug=self.workspace.slug)
        card = next(item for item in gallery.data["cards"] if item["id"] == published["id"])
        single = serialize_artifact(
            Artifact.objects.select_related("workspace", "published_revision", "category", "cover_asset", "owner").get(id=published["id"]),
            self.owner, "published",
        )
        self.assertEqual(card, single)
        self.assertEqual(card["unavailable_reference_count"], 2)

    def test_restore_published_changes_only_draft_and_preserves_served_revision(self):
        created = self.request("post", self.owner, self.payload(summary="first"))
        artifact_id = created.data["id"]
        self.request("post", self.owner, {"version": 1}, artifact_id, "publish")
        first_revision = Artifact.objects.get(id=artifact_id).published_revision_id
        self.request("patch", self.owner, {"version": 2, "summary": "second"}, artifact_id)
        self.request("post", self.owner, {"version": 3}, artifact_id, "publish")
        published_revision = Artifact.objects.get(id=artifact_id).published_revision_id
        restored = self.request("post", self.owner, {"version": 4, "revision_id": str(first_revision)}, artifact_id, "restore")
        self.assertEqual(restored.status_code, 200, restored.data)
        self.assertEqual(restored.data["status"], Artifact.Status.PUBLISHED)
        self.assertEqual(restored.data["summary"], "first")
        self.assertTrue(restored.data["has_unpublished_changes"])
        self.assertEqual(Artifact.objects.get(id=artifact_id).published_revision_id, published_revision)
        self.assertEqual(self.request("get", self.member, pk=artifact_id).data["summary"], "second")

    def test_workspace_role_owner_write_and_source_project_boundaries(self):
        created = self.request("post", self.owner, self.payload(source_issue_ids=[str(self.issue.id)]))
        self.assertEqual(created.status_code, 201, created.data)
        artifact_id = created.data["id"]
        # A normal member may read a published result, but cannot mutate another owner's draft.
        self.assertEqual(self.request("patch", self.member, self.payload(version=1), artifact_id).status_code, 403)
        self.assertEqual(self.request("post", self.owner, {"version": 1}, artifact_id, "publish").status_code, 200)
        self.assertEqual(self.request("patch", self.member, self.payload(version=2, source_issue_ids=[str(self.private_issue.id)]), artifact_id).status_code, 403)
        # The private-source rejection leaves the valid draft untouched.
        self.assertEqual(Artifact.objects.get(id=artifact_id).sources.count(), 1)

    def test_source_order_is_stable_and_null_source_draft_remains_repairable(self):
        second = Issue.objects.create(project=self.project, name="第二任务")
        ids = [str(second.id), str(self.issue.id)]
        created = self.request("post", self.owner, self.payload(source_issue_ids=ids))
        artifact_id = created.data["id"]
        self.assertEqual(created.data["source_issue_ids"], ids)
        published = self.request("post", self.owner, {"version": 1}, artifact_id, "publish")
        self.assertEqual(published.status_code, 200, published.data)
        detail = self.request("get", self.owner, pk=artifact_id)
        self.assertEqual(detail.data["source_issue_ids"], ids)
        self.assertFalse(detail.data["has_unpublished_changes"])
        # SET_NULL rows remain visible as unavailable references rather than crashing the editor.
        from plane.db.models import ArtifactSource
        ArtifactSource.objects.filter(artifact_id=artifact_id, issue_id=second.id).update(issue=None)
        draft = self.request("get", self.owner, pk=artifact_id, query="view=draft")
        self.assertEqual(draft.status_code, 200, draft.data)
        self.assertEqual(draft.data["unavailable_reference_count"], 1)

    def test_partial_patch_preserves_omitted_relationships_and_rejects_invalid_explicit_clear(self):
        category = ArtifactCategory.objects.create(workspace=self.workspace, name="产品")
        asset = FileAsset.objects.create(workspace=self.workspace, user=self.owner, issue=self.issue, project=self.project,
                                         entity_type=FileAsset.EntityTypeContext.ISSUE_ATTACHMENT, is_uploaded=True,
                                         asset="partial.pdf", attributes={"name": "partial.pdf", "size": 64, "type": "application/pdf"}, size=64)
        created = self.request("post", self.owner, self.payload(category_id=str(category.id), source_issue_ids=[str(self.issue.id)],
                                     assets=[{"id": str(asset.id)}], cover_asset_id=str(asset.id)))
        self.assertEqual(created.status_code, 201, created.data)
        artifact_id = created.data["id"]
        partial = self.request("patch", self.owner, {"version": 1, "summary": "只改说明"}, artifact_id)
        self.assertEqual(partial.status_code, 200, partial.data)
        self.assertEqual(partial.data["category_id"], str(category.id))
        self.assertEqual(partial.data["source_issue_ids"], [str(self.issue.id)])
        self.assertEqual([row["id"] for row in partial.data["assets"]], [str(asset.id)])
        self.assertEqual(partial.data["links"][0]["url"], "https://example.invalid/demo")
        self.assertEqual(partial.data["cover"]["asset_id"], str(asset.id))
        invalid_clear = self.request("patch", self.owner, {"version": 2, "links": []}, artifact_id)
        self.assertEqual(invalid_clear.status_code, 400)
        self.assertEqual(Artifact.objects.get(id=artifact_id).version, 2)
        cleared = self.request("patch", self.owner, {"version": 2, "links": [], "primary_action": {"type": "detail", "label": "详情"}}, artifact_id)
        self.assertEqual(cleared.status_code, 200, cleared.data)
        self.assertEqual(cleared.data["links"], [])
        self.assertEqual(cleared.data["source_issue_ids"], [str(self.issue.id)])
        self.assertEqual([row["id"] for row in cleared.data["assets"]], [str(asset.id)])
        self.assertEqual(cleared.data["cover"]["asset_id"], str(asset.id))

    def test_malformed_json_payloads_return_400_without_mutating_artifact(self):
        before = Artifact.objects.count()
        malformed_create = self.request("post", self.owner, self.payload(source_issue_ids={"bad": "shape"}))
        self.assertEqual(malformed_create.status_code, 400)
        malformed_asset = self.request("post", self.owner, self.payload(assets=[{"id": None}]))
        self.assertEqual(malformed_asset.status_code, 400)
        self.assertEqual(Artifact.objects.count(), before)
        created = self.request("post", self.owner, self.payload())
        artifact_id = created.data["id"]
        invalid_patches = [
            {"source_issue_ids": {"bad": "shape"}},
            {"source_issue_ids": [None]},
            {"links": [None]},
            {"category_id": "not-a-uuid"},
            {"summary": {"unexpected": "object"}},
            {"primary_action": {"type": "detail", "label": {"nested": "object"}}},
        ]
        for patch in invalid_patches:
            response = self.request("patch", self.owner, {"version": 1, **patch}, artifact_id)
            self.assertEqual(response.status_code, 400, (patch, response.data))
            artifact = Artifact.objects.get(id=artifact_id)
            self.assertEqual(artifact.version, 1)
            self.assertEqual(artifact.summary, "简介")

    def test_workspace_admin_without_project_membership_cannot_read_private_project_material(self):
        created = self.request("post", self.owner, self.payload())
        artifact_id = created.data["id"]
        self.assertEqual(self.request("post", self.owner, {"version": 1}, artifact_id, "publish").status_code, 200)
        denied = self.request("patch", self.unassigned_admin, self.payload(version=2, source_issue_ids=[str(self.private_issue.id)]), artifact_id)
        self.assertEqual(denied.status_code, 403)
        self.assertEqual(Artifact.objects.get(id=artifact_id).sources.count(), 0)

    def test_metadata_patch_rechecks_merged_source_access_and_owner_can_explicitly_repair(self):
        asset = FileAsset.objects.create(workspace=self.workspace, user=self.owner, issue=self.issue, project=self.project,
                                         entity_type=FileAsset.EntityTypeContext.ISSUE_ATTACHMENT, is_uploaded=True,
                                         asset="membership.pdf", attributes={"name": "membership.pdf", "size": 64, "type": "application/pdf"}, size=64)
        created = self.request("post", self.owner, self.payload(source_issue_ids=[str(self.issue.id)], assets=[{"id": str(asset.id)}]))
        artifact_id = created.data["id"]
        self.assertEqual(self.request("post", self.owner, {"version": 1}, artifact_id, "publish").status_code, 200)
        ProjectMember.objects.filter(project=self.project, member=self.member).delete()
        denied = self.request("patch", self.member, {"version": 2, "summary": "unauthorized"}, artifact_id)
        self.assertEqual(denied.status_code, 403)
        artifact = Artifact.objects.get(id=artifact_id)
        self.assertEqual(artifact.version, 2)
        self.assertEqual(artifact.summary, "简介")
        source_only_clear = self.request("patch", self.owner, {"version": 2, "source_issue_ids": []}, artifact_id)
        self.assertEqual(source_only_clear.status_code, 400)
        self.assertEqual(Artifact.objects.get(id=artifact_id).version, 2)
        repaired = self.request("patch", self.owner, {"version": 2, "source_issue_ids": [], "assets": [], "summary": "repaired"}, artifact_id)
        self.assertEqual(repaired.status_code, 200, repaired.data)
        self.assertEqual(repaired.data["source_issue_ids"], [])
        self.assertEqual(repaired.data["assets"], [])

    def test_api_key_url_resolves_to_api_key_view_and_authenticates(self):
        token = APIToken.objects.create(user=self.owner, workspace=self.workspace, token="artifact-test-api-key")
        client = APIClient()
        response = client.get(f"/api/v1/workspaces/{self.workspace.slug}/artifacts/", HTTP_X_API_KEY=token.token)
        self.assertEqual(response.status_code, 200, getattr(response, "data", None))
        self.assertEqual(response.data["count"], 0)

    def test_first_publish_opens_workspace_collaboration(self):
        created = self.request("post", self.owner, self.payload())
        artifact_id = created.data["id"]
        self.assertEqual(self.request("patch", self.member, self.payload(version=1, summary="private edit"), artifact_id).status_code, 403)
        self.assertEqual(self.request("post", self.owner, {"version": 1}, artifact_id, "publish").status_code, 200)
        shared_edit = self.request("patch", self.member, self.payload(version=2, summary="member edit"), artifact_id)
        self.assertEqual(shared_edit.status_code, 200, shared_edit.data)
        self.assertEqual(shared_edit.data["access"], Artifact.Access.WORKSPACE)
        withdrawn = self.request("post", self.member, {"version": 3}, artifact_id, "withdraw")
        self.assertEqual(withdrawn.status_code, 200, withdrawn.data)
        self.assertEqual(self.request("get", self.member).data["count"], 0)

    def test_shared_member_can_upload_but_private_draft_member_cannot(self):
        created = self.request("post", self.owner, self.payload())
        artifact_id = created.data["id"]
        factory = APIRequestFactory()

        def upload(user):
            request = factory.post(f"/api/workspaces/{self.workspace.slug}/artifacts/{artifact_id}/uploads/",
                                  {"file": SimpleUploadedFile("member.pdf", b"1234", content_type="application/pdf")}, format="multipart")
            force_authenticate(request, user=user)
            return ArtifactUploadEndpoint.as_view()(request, slug=self.workspace.slug, pk=artifact_id)

        with patch("plane.app.views.artifact.S3Storage") as storage_class:
            storage_class.return_value.upload_file.return_value = True
            self.assertEqual(upload(self.member).status_code, 403)
        self.assertEqual(self.request("post", self.owner, {"version": 1}, artifact_id, "publish").status_code, 200)
        with patch("plane.app.views.artifact.S3Storage") as storage_class:
            storage_class.return_value.upload_file.return_value = True
            uploaded = upload(self.member)
        self.assertEqual(uploaded.status_code, 201, uploaded.data)
        asset = FileAsset.objects.get(id=uploaded.data["id"])
        self.assertEqual(asset.user_id, self.member.id)
        self.assertEqual(asset.entity_identifier, artifact_id)

    def test_delete_requires_version_and_category_revision_usage_blocks_delete(self):
        category = ArtifactCategory.objects.create(workspace=self.workspace, name="研发")
        created = self.request("post", self.owner, self.payload(category_id=str(category.id)))
        artifact_id = created.data["id"]
        self.assertEqual(self.request("delete", self.owner, {}, artifact_id).status_code, 400)
        self.assertEqual(self.request("post", self.owner, {"version": 1}, artifact_id, "publish").status_code, 200)
        factory = APIRequestFactory()
        req = factory.delete(f"/api/workspaces/{self.workspace.slug}/artifact-categories/{category.id}/", {"version": 1}, format="json")
        force_authenticate(req, user=self.owner)
        from plane.app.views.artifact import ArtifactCategoryEndpoint
        response = ArtifactCategoryEndpoint.as_view()(req, slug=self.workspace.slug, pk=category.id)
        self.assertEqual(response.status_code, 409)

    def test_category_rename_updates_published_projection_without_content_change(self):
        category = ArtifactCategory.objects.create(workspace=self.workspace, name="旧分类")
        created = self.request("post", self.owner, self.payload(category_id=str(category.id)))
        artifact_id = created.data["id"]
        published = self.request("post", self.owner, {"version": 1}, artifact_id, "publish")
        self.assertEqual(published.status_code, 200, published.data)
        rename = APIRequestFactory().patch("/categories/", {"version": 1, "name": "新分类"}, format="json")
        force_authenticate(rename, user=self.owner)
        from plane.app.views.artifact import ArtifactCategoryEndpoint
        renamed = ArtifactCategoryEndpoint.as_view()(rename, slug=self.workspace.slug, pk=category.id)
        self.assertEqual(renamed.status_code, 200)
        detail = self.request("get", self.owner, pk=artifact_id)
        self.assertEqual(detail.data["category"], "新分类")
        self.assertFalse(detail.data["has_unpublished_changes"])
        gallery_request = APIRequestFactory().get(f"/api/workspaces/{self.workspace.slug}/gallery/")
        force_authenticate(gallery_request, user=self.owner)
        gallery = WorkspaceGalleryEndpoint.as_view()(gallery_request, slug=self.workspace.slug)
        card = next(item for item in gallery.data["cards"] if item["id"] == artifact_id)
        self.assertEqual(card["category"], "新分类")
        self.assertFalse(card["has_unpublished_changes"])
        duplicate = ArtifactCategory.objects.create(workspace=self.workspace, name="同名分类")
        req = APIRequestFactory().patch("/categories/", {"version": 1, "name": "新分类"}, format="json")
        force_authenticate(req, user=self.owner)
        conflict = ArtifactCategoryEndpoint.as_view()(req, slug=self.workspace.slug, pk=duplicate.id)
        self.assertEqual(conflict.status_code, 400)
        duplicate.refresh_from_db()
        self.assertEqual(duplicate.name, "同名分类")
        self.assertEqual(duplicate.version, 1)

    def test_deleted_source_and_material_are_reported_and_owner_can_repair(self):
        shared = FileAsset.objects.create(workspace=self.workspace, user=self.owner, issue=self.issue, project=self.project,
                                          entity_type=FileAsset.EntityTypeContext.ISSUE_ATTACHMENT, is_uploaded=True,
                                          asset="shared.pdf", attributes={"name": "shared.pdf", "size": 30, "type": "application/pdf"}, size=30)
        created = self.request("post", self.owner, self.payload(source_issue_ids=[str(self.issue.id)], assets=[{"id": str(shared.id)}],
                                     primary_action={"type": "attachment", "label": "材料", "attachment_id": str(shared.id)}))
        self.assertEqual(created.status_code, 201, created.data)
        artifact_id = created.data["id"]
        published = self.request("post", self.owner, {"version": 1}, artifact_id, "publish")
        self.assertEqual(published.status_code, 200, published.data)
        issue_revision = Artifact.objects.get(id=artifact_id).published_revision_id
        self.issue.deleted_at = __import__("django.utils.timezone", fromlist=["now"]).now()
        self.issue.save(update_fields=["deleted_at"])
        shared.is_deleted = True
        shared.save(update_fields=["is_deleted"])
        detail = self.request("get", self.owner, pk=artifact_id)
        self.assertEqual(detail.status_code, 200, detail.data)
        self.assertEqual(detail.data["unavailable_reference_count"], 2)
        stale_restore = APIRequestFactory().post(f"/api/workspaces/{self.workspace.slug}/artifacts/{artifact_id}/revisions/{issue_revision}/restore/", {"version": 2}, format="json")
        force_authenticate(stale_restore, user=self.owner)
        from plane.app.views.artifact import ArtifactEndpoint
        rejected = ArtifactEndpoint.as_view()(stale_restore, slug=self.workspace.slug, pk=artifact_id, action="restore", revision_id=issue_revision)
        self.assertGreaterEqual(rejected.status_code, 400)
        repaired = self.request("patch", self.owner, self.payload(version=2), artifact_id)
        self.assertEqual(repaired.status_code, 200, repaired.data)
        self.assertEqual(repaired.data["unavailable_reference_count"], 0)

    def test_private_artifact_uploads_are_owner_bound_and_shared_files_survive_delete(self):
        created = self.request("post", self.owner, self.payload())
        artifact_id = created.data["id"]
        private = FileAsset.objects.create(workspace=self.workspace, user=self.owner, entity_type=FileAsset.EntityTypeContext.ARTIFACT_ATTACHMENT,
                                           entity_identifier=artifact_id, is_uploaded=True, attributes={"name": "private.pdf", "size": 20, "type": "application/pdf"}, size=20)
        self.assertEqual(self.request("post", self.owner, {"version": 1}, artifact_id, "publish").status_code, 200)
        denied = self.request("patch", self.member, self.payload(version=2, assets=[{"id": str(private.id)}]), artifact_id)
        self.assertEqual(denied.status_code, 403)
        shared = FileAsset.objects.create(workspace=self.workspace, user=self.owner, issue=self.issue, project=self.project,
                                          entity_type=FileAsset.EntityTypeContext.ISSUE_ATTACHMENT, is_uploaded=True,
                                          attributes={"name": "shared.pdf", "size": 30, "type": "application/pdf"}, size=30)
        # The owner can select the shared task attachment on the next draft version.
        self.assertEqual(self.request("patch", self.owner, self.payload(version=2, source_issue_ids=[str(self.issue.id)], assets=[{"id": str(shared.id)}], primary_action={"type": "attachment", "label": "材料", "attachment_id": str(shared.id)}), artifact_id).status_code, 200)
        self.assertEqual(self.request("delete", self.owner, {"version": 3}, artifact_id).status_code, 204)
        shared.refresh_from_db()
        self.assertFalse(shared.is_deleted)
        self.assertIsNone(shared.deleted_at)

    def test_publish_requires_material_and_unsafe_url_is_rejected(self):
        created = self.request("post", self.owner, self.payload(links=[] , primary_action={"type": "detail", "label": "详情"}))
        self.assertEqual(created.status_code, 201, created.data)
        self.assertEqual(self.request("post", self.owner, {"version": 1}, created.data["id"], "publish").status_code, 400)
        valid_link = {"title": "主链接", "url": "https://example.invalid/", "kind": "demo"}
        unsafe_urls = [
            "javascript:alert(1)",
            "data:text/html,unsafe",
            "file:///etc/passwd",
            "//example.invalid/path",
            "http:///missing-host",
            "http://[broken",
        ]
        initial_count = Artifact.objects.count()
        for unsafe_url in unsafe_urls:
            with self.subTest(url=unsafe_url):
                bad = self.request(
                    "post",
                    self.owner,
                    self.payload(
                        links=[valid_link, {"title": "坏链接", "url": unsafe_url, "kind": "reference"}],
                        primary_action={"type": "detail", "label": "详情"},
                    ),
                )
                self.assertEqual(bad.status_code, 400)
                self.assertEqual(Artifact.objects.count(), initial_count)

        created_safe = self.request("post", self.owner, self.payload(primary_action={"type": "detail", "label": "详情"}))
        artifact_id = created_safe.data["id"]
        before_materials = list(Artifact.objects.get(id=artifact_id).materials.values_list("title", "url", "kind", "position"))
        patched = self.request(
            "patch",
            self.owner,
            {
                "version": 1,
                "links": [valid_link, {"title": "坏链接", "url": "javascript:alert(1)", "kind": "reference"}],
                "primary_action": {"type": "detail", "label": "详情"},
            },
            artifact_id,
        )
        self.assertEqual(patched.status_code, 400)
        unchanged = Artifact.objects.get(id=artifact_id)
        self.assertEqual(unchanged.version, 1)
        self.assertEqual(list(unchanged.materials.values_list("title", "url", "kind", "position")), before_materials)

    def test_publish_revalidates_all_effective_material_urls(self):
        created = self.request("post", self.owner, self.payload(primary_action={"type": "detail", "label": "详情"}))
        artifact_id = created.data["id"]
        published = self.request("post", self.owner, {"version": 1}, artifact_id, "publish")
        self.assertEqual(published.status_code, 200, published.data)
        artifact = Artifact.objects.get(id=artifact_id)
        prior_revision_id = artifact.published_revision_id
        artifact.materials.filter(url__isnull=False).update(url="javascript:alert(1)")

        rejected = self.request("post", self.owner, {"version": artifact.version}, artifact_id, "publish")
        self.assertEqual(rejected.status_code, 400)
        artifact.refresh_from_db()
        self.assertEqual(artifact.published_revision_id, prior_revision_id)
        self.assertEqual(artifact.version, 2)
        self.assertEqual(artifact.revisions.count(), 1)

    def test_upload_uses_configured_limit_storage_failure_and_owner_binding(self):
        created = self.request("post", self.owner, self.payload())
        artifact_id = created.data["id"]
        factory = APIRequestFactory()

        def upload(data, user=self.owner):
            request = factory.post(f"/api/workspaces/{self.workspace.slug}/artifacts/{artifact_id}/uploads/", data, format="multipart")
            force_authenticate(request, user=user)
            return ArtifactUploadEndpoint.as_view()(request, slug=self.workspace.slug, pk=artifact_id)

        with override_settings(FILE_SIZE_LIMIT=8):
            too_large = upload({"file": SimpleUploadedFile("large.pdf", b"123456789", content_type="application/pdf")})
            self.assertEqual(too_large.status_code, 400)
            self.assertEqual(FileAsset.objects.filter(entity_identifier=artifact_id).count(), 0)

        storage = Mock()
        storage.upload_file.return_value = False
        with patch("plane.app.views.artifact.S3Storage", return_value=storage):
            failed = upload({"file": SimpleUploadedFile("failed.pdf", b"1234", content_type="application/pdf")})
        self.assertEqual(failed.status_code, 502)
        self.assertEqual(FileAsset.objects.filter(entity_identifier=artifact_id).count(), 0)

        from botocore.exceptions import EndpointConnectionError
        storage.upload_file.side_effect = EndpointConnectionError(endpoint_url="http://unavailable.invalid")
        with patch("plane.app.views.artifact.S3Storage", return_value=storage) as constructor:
            network_failed = upload({"file": SimpleUploadedFile("network.pdf", b"1234", content_type="application/pdf")})
        constructor.assert_called_once_with()
        self.assertEqual(network_failed.status_code, 502)
        self.assertEqual(FileAsset.objects.filter(entity_identifier=artifact_id).count(), 0)
        storage.upload_file.side_effect = None
        storage.upload_file.return_value = True
        with patch("plane.app.views.artifact.S3Storage", return_value=storage) as constructor:
            saved = upload({"file": SimpleUploadedFile("ok.pdf", b"1234", content_type="application/pdf")})
        constructor.assert_called_once_with()
        self.assertEqual(saved.status_code, 201, saved.data)
        asset = FileAsset.objects.get(id=saved.data["id"])
        self.assertEqual(asset.entity_type, FileAsset.EntityTypeContext.ARTIFACT_ATTACHMENT)
        self.assertEqual(asset.user_id, self.owner.id)
        self.assertEqual(asset.entity_identifier, artifact_id)

    def test_artifact_preview_token_rechecks_draft_version_and_membership(self):
        created = self.request("post", self.owner, self.payload())
        artifact_id = created.data["id"]
        asset = FileAsset.objects.create(workspace=self.workspace, user=self.owner,
                                         entity_type=FileAsset.EntityTypeContext.ARTIFACT_ATTACHMENT,
                                         entity_identifier=artifact_id, is_uploaded=True,
                                         asset="artifact-file.pdf", attributes={"name": "artifact.pdf", "size": 10, "type": "application/pdf"}, size=10)
        saved = self.request("patch", self.owner, self.payload(version=1, assets=[{"id": str(asset.id)}]), artifact_id)
        self.assertEqual(saved.status_code, 200, saved.data)
        artifact = Artifact.objects.get(id=artifact_id)
        self.assertEqual(artifact.version, 2)
        draft_claim = {"artifact": str(artifact.id), "revision": None, "draft_version": artifact.version, "user": str(self.owner.id), "asset": str(asset.id)}
        draft_token = signing.dumps(draft_claim, salt=ARTIFACT_SOURCE_SALT, compress=True)

        def source(token):
            request = APIRequestFactory().get(f"/api/artifact-preview-source/{token}/{asset.id.hex}-attachment.pdf")
            return ArtifactPreviewSourceEndpoint.as_view()(request, token=token, filename=f"{asset.id.hex}-attachment.pdf")

        with patch("plane.app.views.attachment_preview.source_response", return_value=HttpResponse("ok")) as source_response:
            self.assertEqual(source(draft_token).status_code, 200)
            self.assertEqual(source_response.call_count, 1)

        artifact.version += 1
        artifact.save(update_fields=["version"])
        with patch("plane.app.views.attachment_preview.source_response") as source_response:
            self.assertEqual(source(draft_token).status_code, 404)
            source_response.assert_not_called()
        published = self.request("post", self.owner, {"version": artifact.version}, artifact_id, "publish")
        self.assertEqual(published.status_code, 200, published.data)
        artifact.refresh_from_db()
        revision = artifact.published_revision
        published_claim = {"artifact": str(artifact.id), "revision": str(revision.id), "user": str(self.owner.id), "asset": str(asset.id)}
        published_token = signing.dumps(published_claim, salt=ARTIFACT_SOURCE_SALT, compress=True)
        with patch("plane.app.views.attachment_preview.source_response", return_value=HttpResponse("ok")) as source_response:
            self.assertEqual(source(published_token).status_code, 200)
            self.assertEqual(source_response.call_count, 1)
        self.assertEqual(self.request("post", self.owner, {"version": artifact.version}, artifact_id, "withdraw").status_code, 200)
        with patch("plane.app.views.attachment_preview.source_response") as source_response:
            self.assertEqual(source(published_token).status_code, 404)
            source_response.assert_not_called()

    def test_disabled_preview_token_actor_is_revoked(self):
        created = self.request("post", self.owner, self.payload())
        artifact_id = created.data["id"]
        asset = FileAsset.objects.create(workspace=self.workspace, user=self.owner,
                                         entity_type=FileAsset.EntityTypeContext.ARTIFACT_ATTACHMENT,
                                         entity_identifier=artifact_id, is_uploaded=True,
                                         asset="revoked.pdf", attributes={"name": "revoked.pdf", "size": 10, "type": "application/pdf"}, size=10)
        self.request("patch", self.owner, self.payload(version=1, source_issue_ids=[str(self.issue.id)], assets=[{"id": str(asset.id)}]), artifact_id)
        artifact = Artifact.objects.get(id=artifact_id)
        token = signing.dumps({"artifact": str(artifact.id), "revision": None, "draft_version": artifact.version,
                               "user": str(self.owner.id), "asset": str(asset.id)}, salt=ARTIFACT_SOURCE_SALT, compress=True)
        self.owner.is_active = False
        self.owner.save(update_fields=["is_active"])
        request = APIRequestFactory().get("/")
        with patch("plane.app.views.attachment_preview.source_response") as source_response:
            response = ArtifactPreviewSourceEndpoint.as_view()(request, token=token, filename=f"{asset.id.hex}-attachment.pdf")
        self.assertEqual(response.status_code, 404)
        source_response.assert_not_called()

    def test_preview_capability_matches_supported_formats_and_office_size_limit(self):
        self.assertTrue(is_previewable_asset("manual.pdf", 40 * 1024 * 1024))
        self.assertTrue(is_previewable_asset("manual.docx", 30 * 1024 * 1024))
        self.assertFalse(is_previewable_asset("manual.docx", 30 * 1024 * 1024 + 1))
        self.assertFalse(is_previewable_asset("archive.exe", 100))

    def test_oversized_office_preview_route_rejects_before_converter_request(self):
        from plane.app.views.gallery import ArtifactAssetEndpoint
        created = self.request("post", self.owner, self.payload())
        artifact_id = created.data["id"]
        asset = FileAsset.objects.create(workspace=self.workspace, user=self.owner,
                                         entity_type=FileAsset.EntityTypeContext.ARTIFACT_ATTACHMENT,
                                         entity_identifier=artifact_id, is_uploaded=True, asset="oversize.docx",
                                         attributes={"name": "oversize.docx", "size": 30 * 1024 * 1024 + 1, "type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document"},
                                         size=30 * 1024 * 1024 + 1)
        self.request("patch", self.owner, self.payload(version=1, assets=[{"id": str(asset.id)}]), artifact_id)
        request = APIRequestFactory().get(f"/api/workspaces/{self.workspace.slug}/artifacts/{artifact_id}/assets/{asset.id}/preview/onlinePreview?view=draft")
        force_authenticate(request, user=self.owner)
        with patch("plane.app.views.attachment_preview.requests.get") as converter:
            response = ArtifactAssetEndpoint.as_view()(request, slug=self.workspace.slug, pk=artifact_id,
                                                       asset_id=asset.id, resource="onlinePreview")
        self.assertEqual(response.status_code, 413)
        converter.assert_not_called()

    def test_draft_preview_paths_preserve_context_and_all_responses_allow_same_origin_frames(self):
        from django.urls import resolve
        created = self.request("post", self.owner, self.payload())
        artifact_id = created.data["id"]
        asset = FileAsset.objects.create(workspace=self.workspace, user=self.owner,
            entity_type=FileAsset.EntityTypeContext.ARTIFACT_ATTACHMENT, entity_identifier=artifact_id,
            is_uploaded=True, asset="preview.md", attributes={"name": "preview.md", "size": 32, "type": "text/markdown"}, size=32)
        saved = self.request("patch", self.owner, self.payload(version=1, assets=[{"id": str(asset.id)}]), artifact_id)
        base = saved.data["attachments"][0]["file_url"]
        self.assertTrue(base.endswith("/draft/"), base)
        self.assertEqual(saved.data["attachments"][0]["source_url"], base + "source/")

        def preview(path, upstream_status, resource_type="text/html", user=None):
            match = resolve(path)
            request = APIRequestFactory().get(path)
            force_authenticate(request, user=user or self.owner)
            upstream = Mock(status_code=upstream_status)
            upstream.headers = {"Content-Type": resource_type}
            upstream.text = "<html><head><title>preview</title></head><body>文件内容</body></html>"
            upstream.iter_content.return_value = iter([b"body{}"])
            with patch("plane.app.views.attachment_preview.requests.get", return_value=upstream) as converter:
                response = match.func(request, **match.kwargs)
            return response, converter

        for resource, content_type in [("onlinePreview", "text/html"), ("css/style.css", "text/css")]:
            for status in (200, 500):
                response, converter = preview(base + "preview/" + resource, status, content_type)
                self.assertEqual(response.status_code, 200 if status == 200 else 502)
                self.assertEqual(response["X-Frame-Options"], "SAMEORIGIN")
                self.assertEqual(response["Content-Security-Policy"], "frame-ancestors 'self'")
                self.assertEqual(response["Cache-Control"], "private, no-store")
                self.assertIn("/draft/preview/", converter.call_args.kwargs["headers"]["X-Base-Url"])
                if status == 500:
                    self.assertIn("下载".encode(), response.content)
        # The published resource route never borrows draft authorization.
        response, converter = preview(base.replace("draft/", "") + "preview/css/style.css", 200)
        self.assertEqual(response.status_code, 404)
        converter.assert_not_called()
        response, converter = preview(base + "preview/css/style.css", 200, user=self.member)
        self.assertEqual(response.status_code, 404)
        converter.assert_not_called()
        self.assertEqual(response["X-Frame-Options"], "SAMEORIGIN")

    def test_converter_source_origin_is_configured_and_server_controlled(self):
        from plane.app.views.gallery import ArtifactAssetEndpoint
        created = self.request("post", self.owner, self.payload(source_issue_ids=[str(self.issue.id)]))
        artifact_id = created.data["id"]
        asset = FileAsset.objects.create(workspace=self.workspace, user=self.owner,
                                         issue=self.issue, project=self.project,
                                         entity_type=FileAsset.EntityTypeContext.ARTIFACT_ATTACHMENT,
                                         entity_identifier=artifact_id, is_uploaded=True, asset="preview.pdf",
                                         attributes={"name": "preview.pdf", "size": 1024, "type": "application/pdf"}, size=1024)
        self.request("patch", self.owner, self.payload(version=1, source_issue_ids=[str(self.issue.id)], assets=[{"id": str(asset.id)}]), artifact_id)
        request = APIRequestFactory().get(f"/api/workspaces/{self.workspace.slug}/artifacts/{artifact_id}/assets/{asset.id}/preview/onlinePreview?view=draft&url=http://attacker.invalid")
        force_authenticate(request, user=self.owner)
        converter_result = Mock(status_code=400)
        with patch.dict("os.environ", {"ATTACHMENT_PREVIEW_SOURCE_URL": "http://stage-api.internal:8000/"}), \
                patch("plane.app.views.attachment_preview.requests.get", return_value=converter_result) as converter:
            response = ArtifactAssetEndpoint.as_view()(request, slug=self.workspace.slug, pk=artifact_id,
                                                       asset_id=asset.id, resource="onlinePreview")
        self.assertEqual(response.status_code, 502)
        source = unquote(base64.b64decode(converter.call_args.kwargs["params"]["url"]).decode())
        self.assertTrue(source.startswith("http://stage-api.internal:8000/api/artifact-preview-source/"))
        self.assertIn(f"{asset.id.hex}-attachment.pdf", source)
        token = urlparse(source).path.split("/api/artifact-preview-source/", 1)[1].split("/", 1)[0]
        self.assertEqual(signing.loads(token, salt=ARTIFACT_SOURCE_SALT)["asset"], str(asset.id))
        self.assertNotIn("attacker.invalid", source)


    def test_assignees_are_workspace_members_not_permissions_and_publish_isolated(self):
        created = self.request('post', self.owner, self.payload(assignee_ids=[str(self.member.id), str(self.member.id)]))
        self.assertEqual(created.status_code, 201, created.data)
        pk = created.data['id']
        self.assertEqual(created.data['assignee_ids'], [str(self.member.id)])
        self.assertEqual(created.data['owner_id'], str(self.owner.id))
        self.assertEqual(self.request('get', self.member, pk=pk).status_code, 404)
        self.assertEqual(self.request('post', self.owner, {'version': 1}, pk, 'publish').status_code, 200)
        edit = self.request('patch', self.owner, {'version': 2, 'assignee_ids': [str(self.owner.id)]}, pk)
        self.assertEqual(edit.status_code, 200, edit.data)
        self.assertEqual(self.request('get', self.member, pk=pk).data['assignee_ids'], [str(self.member.id)])
        self.assertEqual(self.request('get', self.owner, pk=pk, query='view=draft').data['assignee_ids'], [str(self.owner.id)])
        self.assertTrue(self.request('get', self.owner, pk=pk).data['has_unpublished_changes'])
        preserved = self.request('patch', self.owner, {'version': 3, 'summary': 'new'}, pk)
        self.assertEqual(preserved.data['assignee_ids'], [str(self.owner.id)])
        cleared = self.request('patch', self.owner, {'version': 4, 'assignee_ids': []}, pk)
        self.assertEqual(cleared.data['assignee_ids'], [])

    def test_invalid_or_foreign_assignees_are_rejected_atomically(self):
        for ids in (None, 'bad', ['invalid'], [str(self.stranger.id)]):
            response = self.request('post', self.owner, self.payload(assignee_ids=ids))
            self.assertEqual(response.status_code, 400, response.data)
        self.assertFalse(Artifact.objects.exists())

    def test_source_suggestions_do_not_silently_assign(self):
        from plane.app.services.artifacts.service import _serialize_source
        self.issue.assignees.add(self.member, through_defaults={"project": self.project, "workspace": self.workspace})
        source = _serialize_source(self.issue, self.workspace.slug)
        self.assertEqual(source['assignee_ids'], [str(self.member.id)])
        response = self.request('post', self.owner, self.payload(source_issue_ids=[str(self.issue.id)]))
        self.assertEqual(response.status_code, 201, response.data)
        self.assertEqual(response.data['assignee_ids'], [])


    def test_backfill_is_explicit_idempotent_and_preserves_publication_history(self):
        from io import StringIO
        from plane.db.models import IssueAssignee
        from django.utils import timezone
        IssueAssignee.objects.create(issue=self.issue, assignee=self.member, project=self.project, workspace=self.workspace)
        IssueAssignee.objects.create(issue=self.issue, assignee=self.owner, project=self.project, workspace=self.workspace, deleted_at=timezone.now())
        created = self.request('post', self.owner, self.payload(source_issue_ids=[str(self.issue.id)]))
        pk = created.data['id']
        self.request('post', self.owner, {'version': 1}, pk, 'publish')
        old_revision = Artifact.objects.get(pk=pk).published_revision
        old_snapshot = dict(old_revision.snapshot)
        out = StringIO()
        call_command('backfill_artifact_assignees', workspace=self.workspace.slug, actor=str(self.owner.id), stdout=out)
        self.assertEqual(json.loads(out.getvalue())['results'][0]['suggested'], [str(self.member.id)])
        self.assertEqual(self.request('get', self.owner, pk=pk).data['assignee_ids'], [])
        call_command('backfill_artifact_assignees', workspace=self.workspace.slug, actor=str(self.owner.id), apply=True, stdout=StringIO())
        result = self.request('get', self.member, pk=pk).data
        self.assertEqual(result['assignee_ids'], [str(self.member.id)])
        self.assertEqual(result['published_version'], 2)
        old_revision.refresh_from_db()
        self.assertEqual(old_revision.snapshot, old_snapshot)
        count = ArtifactRevision.objects.count()
        call_command('backfill_artifact_assignees', workspace=self.workspace.slug, actor=str(self.owner.id), apply=True, stdout=StringIO())
        self.assertEqual(ArtifactRevision.objects.count(), count)

    def test_restoring_revision_restores_assignees_in_draft_only(self):
        created = self.request('post', self.owner, self.payload(assignee_ids=[str(self.member.id)]))
        pk = created.data['id']
        self.request('post', self.owner, {'version': 1}, pk, 'publish')
        revision = Artifact.objects.get(pk=pk).published_revision
        self.request('patch', self.owner, {'version': 2, 'assignee_ids': []}, pk)
        from plane.app.services.artifacts.restore import restore_revision
        restore_revision(self.owner, Artifact.objects.get(pk=pk), revision.id, 3)
        self.assertEqual(self.request('get', self.owner, pk=pk, query='view=draft').data['assignee_ids'], [str(self.member.id)])


    def test_backfill_never_updates_draft_or_withdrawn_artifacts(self):
        from io import StringIO
        self.issue.assignees.add(self.member, through_defaults={"project": self.project, "workspace": self.workspace})
        first = self.request('post', self.owner, self.payload(source_issue_ids=[str(self.issue.id)]))
        second = self.request('post', self.owner, self.payload(title='withdrawn', source_issue_ids=[str(self.issue.id)]))
        self.request('post', self.owner, {'version': 1}, second.data['id'], 'publish')
        self.request('post', self.owner, {'version': 2}, second.data['id'], 'withdraw')
        out = StringIO()
        call_command('backfill_artifact_assignees', workspace=self.workspace.slug, actor=str(self.owner.id), apply=True, stdout=out)
        self.assertEqual({row['action'] for row in json.loads(out.getvalue())['results']}, {'skip-not-published'})
        for pk in (first.data['id'], second.data['id']):
            self.assertFalse(Artifact.objects.get(pk=pk).assignees.exists())

    def test_departed_workspace_member_cannot_be_assigned_or_restored(self):
        created = self.request('post', self.owner, self.payload(assignee_ids=[str(self.member.id)]))
        pk = created.data['id']
        self.request('post', self.owner, {'version': 1}, pk, 'publish')
        revision = Artifact.objects.get(pk=pk).published_revision
        WorkspaceMember.objects.filter(workspace=self.workspace, member=self.member).update(is_active=False)
        updated = self.request('patch', self.owner, {'version': 2, 'assignee_ids': [str(self.member.id)]}, pk)
        self.assertEqual(updated.status_code, 400)
        self.assertEqual(self.request('post', self.owner, {'version': 2}, pk, 'publish').status_code, 400)
        self.assertEqual(Artifact.objects.get(pk=pk).version, 2)
        from plane.app.services.artifacts.restore import restore_revision
        from rest_framework.exceptions import ValidationError
        with self.assertRaises(ValidationError):
            restore_revision(self.owner, Artifact.objects.get(pk=pk), revision.id, 2)
        self.assertEqual(Artifact.objects.get(pk=pk).version, 2)


class ArtifactImportCommandTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        cls.owner = User.objects.create(email="artifact-import@example.invalid", username="artifact-import")
        cls.workspace = Workspace.objects.create(name="Import QA", slug="artifact-import-qa", owner=cls.owner)
        WorkspaceMember.objects.create(workspace=cls.workspace, member=cls.owner, role=20)

    def test_default_input_path_resolves_archived_manifest(self):
        with self.assertRaisesRegex(CommandError, "Input workspace_id does not match --workspace"):
            call_command("import_artifacts", workspace=self.workspace.slug, owner=self.owner.email)

    def test_dry_run_apply_idempotence_and_conflicting_existing_row(self):
        manifest = {"workspace_id": str(self.workspace.id), "categories": [], "cards": [{
            "key": "one", "title": "Imported", "summary": "original", "kind": "system", "category": None,
            "sources": [], "assets": [], "links": [{"title": "Demo", "url": "https://example.invalid", "kind": "demo"}],
            "primary_action": {"type": "detail", "label": "详情"}, "cover_asset_id": None,
        }]}
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory) / "gallery.json"
            source.write_text(json.dumps(manifest), encoding="utf-8")
            output = tempfile.TemporaryFile(mode="w+")
            common = {"workspace": str(self.workspace.id), "owner": str(self.owner.id), "input": str(source), "stdout": output}
            call_command("import_artifacts", **common)
            imported_id = uuid.uuid5(uuid.UUID(str(self.workspace.id)), "one")
            self.assertFalse(Artifact.objects.filter(id=imported_id).exists())
            call_command("import_artifacts", **common, apply=True)
            artifact = Artifact.objects.get(id=imported_id)
            self.assertEqual(artifact.access, Artifact.Access.WORKSPACE)
            self.assertFalse(self._has_unpublished_changes(artifact))
            output.seek(0)
            output.truncate(0)
            call_command("import_artifacts", **common, apply=True)
            self.assertEqual(Artifact.objects.filter(workspace=self.workspace).count(), 1)
            artifact.title = "human edited"
            artifact.save(update_fields=["title"])
            output.seek(0)
            output.truncate(0)
            call_command("import_artifacts", **common)
            output.seek(0)
            self.assertIn("error: one", output.read())
            self.assertEqual(Artifact.objects.get(id=imported_id).title, "human edited")

    def test_apply_validation_failure_rolls_back_entire_manifest(self):
        manifest = {"workspace_id": str(self.workspace.id), "cards": [
            {"key": "good", "title": "Good", "summary": "", "kind": "system", "sources": [], "assets": [], "links": [{"title": "Demo", "url": "https://example.invalid", "kind": "demo"}]},
            {"key": "bad", "title": "Bad", "summary": "", "kind": "system", "sources": [], "assets": [], "links": [{"title": "No", "url": "javascript:alert(1)", "kind": "demo"}]},
        ]}
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory) / "gallery.json"
            source.write_text(json.dumps(manifest), encoding="utf-8")
            with self.assertRaises(CommandError):
                call_command("import_artifacts", workspace=str(self.workspace.id), owner=str(self.owner.id), input=str(source), apply=True)
        self.assertFalse(Artifact.objects.filter(workspace=self.workspace).exists())

    def _has_unpublished_changes(self, artifact):
        from plane.app.services.artifacts import serialize_artifact
        return serialize_artifact(artifact, self.owner, "published")["has_unpublished_changes"]
