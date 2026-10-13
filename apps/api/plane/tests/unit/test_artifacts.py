"""Artifact lifecycle and authorization contracts for the Django test runner."""
import json
import tempfile
import uuid
from pathlib import Path

from django.core.management import call_command, CommandError
from django.test import TestCase, override_settings
from django.core.files.uploadedfile import SimpleUploadedFile
from django.core import signing
from django.http import HttpResponse
from unittest.mock import Mock, patch
from rest_framework.test import APIClient, APIRequestFactory, force_authenticate

from plane.app.views.artifact import ArtifactEndpoint
from plane.app.views.artifact import ArtifactUploadEndpoint
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
        self.assertEqual(restored.data["status"], Artifact.Status.DRAFT)
        self.assertEqual(self.request("get", self.member).data["count"], 0)

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

    def test_workspace_admin_without_project_membership_cannot_read_private_project_material(self):
        created = self.request("post", self.owner, self.payload())
        artifact_id = created.data["id"]
        self.assertEqual(self.request("post", self.owner, {"version": 1}, artifact_id, "publish").status_code, 200)
        denied = self.request("patch", self.unassigned_admin, self.payload(version=2, source_issue_ids=[str(self.private_issue.id)]), artifact_id)
        self.assertEqual(denied.status_code, 403)
        self.assertEqual(Artifact.objects.get(id=artifact_id).sources.count(), 0)

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
        self.assertEqual(self.request("patch", self.owner, self.payload(version=2, assets=[{"id": str(shared.id)}], primary_action={"type": "attachment", "label": "材料", "attachment_id": str(shared.id)}), artifact_id).status_code, 200)
        self.assertEqual(self.request("delete", self.owner, {"version": 3}, artifact_id).status_code, 204)
        shared.refresh_from_db()
        self.assertFalse(shared.is_deleted)
        self.assertIsNone(shared.deleted_at)

    def test_publish_requires_material_and_unsafe_url_is_rejected(self):
        created = self.request("post", self.owner, self.payload(links=[] , primary_action={"type": "detail", "label": "详情"}))
        self.assertEqual(created.status_code, 201, created.data)
        self.assertEqual(self.request("post", self.owner, {"version": 1}, created.data["id"], "publish").status_code, 400)
        bad = self.request("post", self.owner, self.payload(links=[{"title": "坏链接", "url": "javascript:alert(1)", "kind": "reference"}], primary_action={"type": "detail", "label": "详情"}))
        self.assertEqual(bad.status_code, 400)

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

        storage.upload_file.return_value = True
        with patch("plane.app.views.artifact.S3Storage", return_value=storage):
            saved = upload({"file": SimpleUploadedFile("ok.pdf", b"1234", content_type="application/pdf")})
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
        self.request("patch", self.owner, self.payload(version=1, assets=[{"id": str(asset.id)}]), artifact_id)
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


class ArtifactImportCommandTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        cls.owner = User.objects.create(email="artifact-import@example.invalid", username="artifact-import")
        cls.workspace = Workspace.objects.create(name="Import QA", slug="artifact-import-qa", owner=cls.owner)
        WorkspaceMember.objects.create(workspace=cls.workspace, member=cls.owner, role=20)

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
