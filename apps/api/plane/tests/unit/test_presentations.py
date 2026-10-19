import uuid

from django.test import TestCase
from rest_framework.test import APIRequestFactory, force_authenticate
from unittest.mock import patch
from django.http import HttpResponse
from django.core import signing

from plane.app.views.presentation import PresentationEndpoint, PresentationAssetEndpoint
from plane.app.views.attachment_preview import PresentationPreviewSourceEndpoint, PRESENTATION_SOURCE_SALT
from plane.app.services.presentations import presentation_source_asset_is_live
from plane.db.models import (
    FileAsset, IssueComment, Presentation, Project, ProjectMember, User, Workspace, WorkspaceMember,
    WorkspaceMemberProjectGrant,
)


class PresentationLifecycleTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        cls.owner = User.objects.create(email="presentation-owner@example.invalid", username="presentation-owner")
        cls.writer = User.objects.create(email="presentation-writer@example.invalid", username="presentation-writer")
        cls.observer = User.objects.create(email="presentation-observer@example.invalid", username="presentation-observer")
        cls.guest = User.objects.create(email="presentation-guest@example.invalid", username="presentation-guest")
        cls.workspace = Workspace.objects.create(name="Presentation QA", slug="presentation-qa", owner=cls.owner)
        cls.other_workspace = Workspace.objects.create(name="Other", slug="presentation-other", owner=cls.owner)
        WorkspaceMember.objects.create(workspace=cls.workspace, member=cls.owner, role=20)
        WorkspaceMember.objects.create(workspace=cls.workspace, member=cls.writer, role=15)
        WorkspaceMember.objects.create(workspace=cls.workspace, member=cls.guest, role=5)
        observer_membership = WorkspaceMember.objects.create(workspace=cls.workspace, member=cls.observer, role=5, access_profile="summary_observer")
        WorkspaceMember.objects.create(workspace=cls.other_workspace, member=cls.owner, role=20)
        cls.project = Project.objects.create(name="PRES", identifier="PRS", workspace=cls.workspace)
        cls.other_project = Project.objects.create(name="Other", identifier="OTH", workspace=cls.other_workspace)
        for user, role in ((cls.owner, 20), (cls.writer, 15), (cls.observer, 5), (cls.guest, 5)):
            ProjectMember.objects.create(project=cls.project, workspace=cls.workspace, member=user, role=role)
        WorkspaceMemberProjectGrant.objects.create(workspace_member=observer_membership, project=cls.project)

    @staticmethod
    def document(body="# Agenda"):
        return {"schema_version": 1, "sections": [{"id": str(uuid.uuid4()), "title": "Overview", "slides": [{
            "id": str(uuid.uuid4()), "title": "Weekly update", "body": body, "notes": "", "issue_ids": [], "media": [], "links": [],
        }]}]}

    def request(self, method, user, data=None, pk=None, action=None, query=None, slug=None):
        slug = slug or self.workspace.slug
        path = f"/api/workspaces/{slug}/presentations/"
        if pk:
            path += f"{pk}/"
        if action:
            path += f"{action}/"
        if query:
            path += f"?{query}"
        req = getattr(APIRequestFactory(), method)(path, data or {}, format="json")
        force_authenticate(req, user=user)
        kwargs = {"slug": slug}
        if pk:
            kwargs["pk"] = pk
        if action:
            kwargs["action"] = action
        return PresentationEndpoint.as_view()(req, **kwargs)

    def create(self, user=None, **overrides):
        data = {"title": "Weekly", "project_id": str(self.project.id), "document": self.document()}
        data.update(overrides)
        return self.request("post", user or self.owner, data)

    def test_create_publish_draft_isolation_and_optimistic_lock(self):
        created = self.create()
        self.assertEqual(created.status_code, 201, created.data)
        pk = created.data["id"]
        self.assertEqual(self.request("get", self.writer, pk=pk).data["document"]["sections"][0]["slides"][0]["body"], "# Agenda")
        patched = self.request("patch", self.owner, {"version": 1, "document": self.document("Draft only")}, pk)
        self.assertEqual(patched.status_code, 200, patched.data)
        self.assertEqual(self.request("patch", self.owner, {"version": 1, "title": "stale"}, pk).status_code, 409)
        published = self.request("post", self.owner, {"version": 2}, pk, "publish")
        self.assertEqual(published.status_code, 200, published.data)
        revision_id = Presentation.objects.get(pk=pk).published_revision_id
        draft = self.request("patch", self.owner, {"version": 3, "document": self.document("New draft")}, pk)
        self.assertEqual(draft.status_code, 200)
        self.assertTrue(draft.data["has_unpublished_changes"])
        public = self.request("get", self.writer, pk=pk)
        self.assertEqual(public.data["document"]["sections"][0]["slides"][0]["body"], "Draft only")
        self.assertEqual(self.request("get", self.owner, pk=pk, query="view=draft").data["document"]["sections"][0]["slides"][0]["body"], "New draft")
        self.assertEqual(str(Presentation.objects.get(pk=pk).published_revision_id), str(revision_id))
        with_notes = self.document()
        with_notes["sections"][0]["slides"][0]["notes"] = "Editor-only speaker notes"
        self.assertEqual(self.request("patch", self.owner, {"version": 4, "document": with_notes}, pk).status_code, 200)
        self.assertEqual(self.request("post", self.owner, {"version": 5}, pk, "publish").status_code, 200)
        editor_detail = self.request("get", self.owner, pk=pk)
        observer_detail = self.request("get", self.observer, pk=pk)
        self.assertEqual(editor_detail.data["document"]["sections"][0]["slides"][0]["notes"], "Editor-only speaker notes")
        self.assertEqual(observer_detail.data["document"]["sections"][0]["slides"][0]["notes"], "")

    def test_project_and_workspace_scope_and_observer_grant(self):
        created = self.create()
        pk = created.data["id"]
        self.assertEqual(self.request("post", self.owner, {"title": "bad", "project_id": str(self.other_project.id), "document": self.document()}).status_code, 400)
        self.assertEqual(self.request("patch", self.writer, {"version": 1, "title": "x"}, pk).status_code, 200)
        self.request("post", self.owner, {"version": 2}, pk, "publish")
        self.assertEqual(self.request("get", self.observer, pk=pk).status_code, 200)
        self.assertEqual(self.request("get", self.observer, pk=pk, query="view=draft").status_code, 404)
        self.assertEqual(self.request("get", self.owner, pk=pk, slug=self.other_workspace.slug).status_code, 404)
        WorkspaceMemberProjectGrant.objects.filter(workspace_member__member=self.observer).delete()
        self.assertEqual(self.request("get", self.observer, pk=pk).status_code, 403)

    def test_schema_rejects_html_script_and_unsafe_links(self):
        bad = self.create(user=self.owner, document=self.document("<script>alert(1)</script>"))
        self.assertEqual(bad.status_code, 400)
        doc = self.document()
        doc["sections"][0]["slides"][0]["links"] = [{"label": "bad", "url": "javascript:alert(1)"}]
        bad = self.create(user=self.owner, document=doc)
        self.assertEqual(bad.status_code, 400)

    def test_create_strips_response_only_media_urls_before_storage(self):
        from plane.db.models import Issue
        issue = Issue.objects.create(project=self.project, name="Media source")
        asset = FileAsset.objects.create(
            workspace=self.workspace, project=self.project, issue=issue, user=self.owner,
            entity_type=FileAsset.EntityTypeContext.ISSUE_ATTACHMENT, is_uploaded=True,
            attributes={"name": "media.png", "type": "image/png"}, size=10,
        )
        document = self.document()
        document["sections"][0]["slides"][0]["media"] = [{
            "asset_id": str(asset.id), "caption": "Media", "file_url": "https://attacker.invalid/private",
            "preview_url": "javascript:alert(1)", "filename": "fake.svg", "mime_type": "text/html", "can_preview": True,
        }]
        created = self.create(document=document)
        self.assertEqual(created.status_code, 201, created.data)
        stored_media = Presentation.objects.get(pk=created.data["id"]).document["sections"][0]["slides"][0]["media"][0]
        self.assertEqual(stored_media, {"asset_id": str(asset.id), "caption": "Media"})

    def test_tombstoned_prefetched_object_cannot_be_updated_or_published(self):
        from django.utils import timezone
        from rest_framework.exceptions import NotFound
        from plane.app.services.presentations import publish_presentation, update_presentation
        created = self.create()
        stale = Presentation.objects.get(pk=created.data["id"])
        Presentation.objects.filter(pk=stale.pk).update(deleted_at=timezone.now())
        with self.assertRaises(NotFound):
            update_presentation(self.owner, stale, {"version": 1, "title": "Revived"})
        with self.assertRaises(NotFound):
            publish_presentation(self.owner, stale, 1)

    def test_published_media_is_project_grant_scoped_and_revocable(self):
        from plane.db.models import Issue
        issue = Issue.objects.create(project=self.project, name="Media source")
        asset = FileAsset.objects.create(
            workspace=self.workspace, project=self.project, issue=issue, user=self.owner,
            entity_type=FileAsset.EntityTypeContext.ISSUE_ATTACHMENT, is_uploaded=True,
            attributes={"name": "deck.png", "size": 20, "type": "image/png"}, size=20,
        )
        document = self.document()
        document["sections"][0]["slides"][0]["media"] = [{"asset_id": str(asset.id), "caption": "Figure"}]
        created = self.create(document=document)
        self.assertEqual(created.status_code, 201, created.data)
        pk = created.data["id"]
        self.assertEqual(self.request("post", self.owner, {"version": 1}, pk, "publish").status_code, 200)
        direct_request = APIRequestFactory().get(f"/api/workspaces/{self.workspace.slug}/presentations/{pk}/assets/{asset.id}/")
        force_authenticate(direct_request, user=self.writer)
        source_body = type("SourceBody", (), {"iter_chunks": lambda self, chunk_size: iter([b"source"]), "close": lambda self: None})()
        with patch("plane.app.views.attachment_preview.S3Storage") as storage_class:
            storage_class.return_value.aws_storage_bucket_name = "test-bucket"
            storage_class.return_value.s3_client.get_object.return_value = {"Body": source_body, "ContentLength": 6}
            direct = PresentationAssetEndpoint.as_view()(direct_request, slug=self.workspace.slug, pk=pk, asset_id=asset.id)
        self.assertIn("sandbox", direct["Content-Security-Policy"])
        self.assertIn("frame-ancestors 'self'", direct["Content-Security-Policy"])
        self.assertNotIn("Location", direct)
        self.assertEqual(direct.status_code, 200)
        request = APIRequestFactory().get(f"/api/workspaces/{self.workspace.slug}/presentations/{pk}/assets/{asset.id}/preview/onlinePreview")
        force_authenticate(request, user=self.observer)
        with patch("plane.app.views.presentation.preview_authorized_asset", return_value=HttpResponse("ok")) as preview:
            allowed = PresentationAssetEndpoint.as_view()(request, slug=self.workspace.slug, pk=pk, asset_id=asset.id, resource="onlinePreview")
        self.assertEqual(allowed.status_code, 200)
        claim = preview.call_args.args[0].artifact_preview_claim
        token = signing.dumps(claim, salt=PRESENTATION_SOURCE_SALT, compress=True)
        source_request = APIRequestFactory().get("/api/presentation-preview-source/")
        with patch("plane.app.views.attachment_preview.source_response", return_value=HttpResponse("source")) as source:
            source_allowed = PresentationPreviewSourceEndpoint.as_view()(source_request, token=token, filename=f"{asset.id.hex}-attachment.png")
            source.assert_called_once()
        self.assertEqual(source_allowed.status_code, 200)
        guest_request = APIRequestFactory().get(f"/api/workspaces/{self.workspace.slug}/presentations/{pk}/assets/{asset.id}/")
        force_authenticate(guest_request, user=self.guest)
        with patch("plane.app.views.presentation.source_response", return_value=HttpResponse("curated material")):
            guest_allowed = PresentationAssetEndpoint.as_view()(guest_request, slug=self.workspace.slug, pk=pk, asset_id=asset.id)
        self.assertEqual(guest_allowed.status_code, 200)
        from plane.app.views.issue.base import IssueDetailEndpoint
        from plane.api.views.issue import IssueDetailAPIEndpoint
        task_request = APIRequestFactory().get(f"/api/workspaces/{self.workspace.slug}/projects/{self.project.id}/issues-detail/")
        force_authenticate(task_request, user=self.observer)
        task_detail = IssueDetailEndpoint.as_view()(task_request, slug=self.workspace.slug, project_id=self.project.id)
        self.assertEqual(task_detail.status_code, 403)
        api_task_request = APIRequestFactory().get(f"/api/v1/workspaces/{self.workspace.slug}/projects/{self.project.id}/work-items/{issue.id}/")
        force_authenticate(api_task_request, user=self.observer)
        api_task_detail = IssueDetailAPIEndpoint.as_view()(api_task_request, slug=self.workspace.slug, project_id=self.project.id, pk=issue.id)
        self.assertEqual(api_task_detail.status_code, 403)
        unrelated = FileAsset.objects.create(
            workspace=self.workspace, project=self.project, issue=issue, user=self.owner,
            entity_type=FileAsset.EntityTypeContext.ISSUE_ATTACHMENT, is_uploaded=True,
            attributes={"name": "unselected.png", "size": 20, "type": "image/png"}, size=20,
        )
        unrelated_request = APIRequestFactory().get(f"/api/workspaces/{self.workspace.slug}/presentations/{pk}/assets/{unrelated.id}/")
        force_authenticate(unrelated_request, user=self.guest)
        unrelated_response = PresentationAssetEndpoint.as_view()(unrelated_request, slug=self.workspace.slug, pk=pk, asset_id=unrelated.id)
        self.assertEqual(unrelated_response.status_code, 404)
        unpublished = self.create(document=document).data["id"]
        unpublished_request = APIRequestFactory().get(f"/api/workspaces/{self.workspace.slug}/presentations/{unpublished}/assets/{asset.id}/")
        force_authenticate(unpublished_request, user=self.guest)
        unpublished_response = PresentationAssetEndpoint.as_view()(unpublished_request, slug=self.workspace.slug, pk=unpublished, asset_id=asset.id)
        self.assertEqual(unpublished_response.status_code, 404)
        WorkspaceMemberProjectGrant.objects.filter(workspace_member__member=self.observer).delete()
        request = APIRequestFactory().get(f"/api/workspaces/{self.workspace.slug}/presentations/{pk}/assets/{asset.id}/preview/onlinePreview")
        force_authenticate(request, user=self.observer)
        revoked = PresentationAssetEndpoint.as_view()(request, slug=self.workspace.slug, pk=pk, asset_id=asset.id, resource="onlinePreview")
        self.assertEqual(revoked.status_code, 403)
        revoked_source_request = APIRequestFactory().get("/api/presentation-preview-source/")
        revoked_source = PresentationPreviewSourceEndpoint.as_view()(revoked_source_request, token=token, filename=f"{asset.id.hex}-attachment.png")
        self.assertEqual(revoked_source.status_code, 404)

    def test_derived_preview_retains_source_asset_binding_through_publish(self):
        from plane.db.models import Issue
        issue = Issue.objects.create(project=self.project, name="Preview source")
        source = FileAsset.objects.create(
            workspace=self.workspace, project=self.project, issue=issue, user=self.owner,
            entity_type=FileAsset.EntityTypeContext.ISSUE_ATTACHMENT, is_uploaded=True,
            attributes={"name": "document.pdf", "size": 20, "type": "application/pdf"}, size=20,
        )
        created = self.create()
        self.assertEqual(created.status_code, 201, created.data)
        presentation_id = created.data["id"]
        preview = FileAsset.objects.create(
            workspace=self.workspace, project=self.project, user=self.owner,
            entity_type="PRESENTATION_ATTACHMENT", entity_identifier=presentation_id,
            is_uploaded=True, attributes={"name": "page.png", "type": "image/png", "source_asset_id": str(source.id)}, size=10,
        )
        document = self.document()
        document["sections"][0]["slides"][0]["media"] = [{
            "asset_id": str(source.id), "preview_asset_id": str(preview.id), "caption": "Selected page",
        }]
        updated = self.request("patch", self.owner, {"version": 1, "document": document}, presentation_id)
        self.assertEqual(updated.status_code, 200, updated.data)
        published = self.request("post", self.owner, {"version": 2}, presentation_id, "publish")
        self.assertEqual(published.status_code, 200, published.data)
        revision_id = Presentation.objects.get(pk=presentation_id).published_revision_id
        preview.attributes = {**preview.attributes, "source_asset_id": str(uuid.uuid4())}
        preview.save(update_fields=["attributes"])
        invalid_publish = self.request("post", self.owner, {"version": 3}, presentation_id, "publish")
        self.assertEqual(invalid_publish.status_code, 400)
        self.assertEqual(Presentation.objects.get(pk=presentation_id).published_revision_id, revision_id)
        preview.attributes = {**preview.attributes, "source_asset_id": str(source.id)}
        preview.save(update_fields=["attributes"])
        from django.utils import timezone
        issue.deleted_at = timezone.now()
        issue.save(update_fields=["deleted_at"])
        read_request = APIRequestFactory().get(f"/api/workspaces/{self.workspace.slug}/presentations/{presentation_id}/assets/{preview.id}/")
        force_authenticate(read_request, user=self.owner)
        issue_deleted_read = PresentationAssetEndpoint.as_view()(read_request, slug=self.workspace.slug, pk=presentation_id, asset_id=preview.id)
        self.assertEqual(issue_deleted_read.status_code, 404)
        token = signing.dumps({
            "presentation": presentation_id, "revision": str(revision_id), "user": str(self.owner.id), "asset": str(preview.id),
        }, salt=PRESENTATION_SOURCE_SALT, compress=True)
        source_request = APIRequestFactory().get("/api/presentation-preview-source/")
        issue_deleted_source = PresentationPreviewSourceEndpoint.as_view()(source_request, token=token, filename=f"{preview.id.hex}-attachment.png")
        self.assertEqual(issue_deleted_source.status_code, 404)
        issue.deleted_at = None
        issue.save(update_fields=["deleted_at"])
        source.is_deleted = True
        source.save(update_fields=["is_deleted"])
        read_request = APIRequestFactory().get(f"/api/workspaces/{self.workspace.slug}/presentations/{presentation_id}/assets/{preview.id}/")
        force_authenticate(read_request, user=self.owner)
        read_denied = PresentationAssetEndpoint.as_view()(read_request, slug=self.workspace.slug, pk=presentation_id, asset_id=preview.id)
        self.assertEqual(read_denied.status_code, 404)
        source_request = APIRequestFactory().get("/api/presentation-preview-source/")
        source_denied = PresentationPreviewSourceEndpoint.as_view()(source_request, token=token, filename=f"{preview.id.hex}-attachment.png")
        self.assertEqual(source_denied.status_code, 404)

    def test_legacy_image_component_asset_resolves_from_live_comment_html(self):
        from plane.db.models import Issue
        issue = Issue.objects.create(project=self.project, name="Image source")
        presentation = Presentation.objects.create(workspace=self.workspace, project=self.project, owner=self.owner,
                                                   title="Image proof", document=self.document())
        asset = FileAsset.objects.create(
            workspace=self.workspace, project=self.project, user=self.owner,
            entity_type=FileAsset.EntityTypeContext.COMMENT_DESCRIPTION, is_uploaded=True,
            attributes={"name": "comment-image.png", "type": "image/png"}, size=10,
        )
        comment = IssueComment.objects.create(
            workspace=self.workspace, project=self.project, issue=issue,
            comment_html=f'<p><image-component src="/api/assets/{asset.id}/"></image-component></p>',
            created_by=self.owner,
        )
        self.assertTrue(presentation_source_asset_is_live(asset, self.workspace, self.project))
        from django.utils import timezone
        comment.deleted_at = timezone.now()
        comment.save(update_fields=["deleted_at"])
        self.assertFalse(presentation_source_asset_is_live(asset, self.workspace, self.project))
