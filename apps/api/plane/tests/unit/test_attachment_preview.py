"""Attachment access, generated cache scope, and upstream source selection."""
import uuid
from unittest.mock import patch, MagicMock
from django.test import TestCase
from django.core import signing
from rest_framework.test import APIRequestFactory, force_authenticate
from plane.db.models import User, Workspace, WorkspaceMember, Project, ProjectMember, Issue, FileAsset
from plane.app.views.attachment_preview import AttachmentPreviewEndpoint, AttachmentPreviewSourceEndpoint, allowed_preview_path, SOURCE_SALT


class AttachmentPreviewTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        cls.member = User.objects.create(email="preview-member@example.invalid", username="preview-member")
        cls.outsider = User.objects.create(email="preview-outside@example.invalid", username="preview-outside")
        cls.workspace = Workspace.objects.create(name="Preview QA", slug="preview-qa", owner=cls.member)
        cls.project = Project.objects.create(name="Preview QA", identifier="PQA", workspace=cls.workspace)
        cls.other = Project.objects.create(name="Other", identifier="OQA", workspace=cls.workspace)
        WorkspaceMember.objects.create(workspace=cls.workspace, member=cls.member, role=15)
        ProjectMember.objects.create(project=cls.project, workspace=cls.workspace, member=cls.member, role=15)
        cls.issue = Issue.objects.create(name="QA", workspace=cls.workspace, project=cls.project)
        cls.asset = FileAsset.objects.create(workspace=cls.workspace, project=cls.project, issue=cls.issue,
              asset="qa/file.md", is_uploaded=True, attributes={"name": "进展.md", "type": "text/markdown", "size": 10},
              entity_type=FileAsset.EntityTypeContext.ISSUE_ATTACHMENT)

    def request(self, resource="onlinePreview", user=True, project=None, query=None):
        path = f"/api/assets/v2/workspaces/preview-qa/projects/{self.project.id}/issues/{self.issue.id}/attachments/{self.asset.id}/preview/{resource}"
        request = APIRequestFactory().get(path, query or {})
        if user:
            force_authenticate(request, user=self.member if user is True else user)
        return AttachmentPreviewEndpoint.as_view()(request, slug="preview-qa", project_id=(project or self.project).id,
                    issue_id=self.issue.id, pk=self.asset.id, resource=resource)

    def test_anonymous_and_outsider_denied(self):
        self.assertIn(self.request(user=False).status_code, [401, 403])
        self.assertEqual(self.request(user=self.outsider).status_code, 403)
        self.assertEqual(self.request(project=self.other).status_code, 403)

    def test_other_attachment_cache_and_traversal_denied(self):
        for resource in [f"{uuid.uuid4().hex}-attachmentmd.pdf", "../secret", "js/%252e%252e/secret", "addTask", "getCorsFile/other"]:
            self.assertEqual(self.request(resource).status_code, 404, resource)
        self.assertTrue(allowed_preview_path(f"{self.asset.id.hex}-attachmentdocx.pdf", self.asset.id))
        self.assertTrue(allowed_preview_path("pdfjs/web/viewer.html", self.asset.id))

    @patch("plane.app.views.attachment_preview.requests.get")
    def test_source_cannot_be_overridden_and_brand_is_internal(self, get):
        result = MagicMock(status_code=200)
        result.headers = {"Content-Type": "text/html"}
        result.text = "<html><head><title>old</title></head><body>预览</body></html>"
        get.return_value = result
        response = self.request(query={"url": "http://attacker.invalid/private", "forceUpdatedCache": "true"})
        self.assertEqual(response.status_code, 200)
        params = get.call_args.kwargs["params"]
        import base64
        source = base64.b64decode(params["url"]).decode()
        self.assertIn("http://api:8000/api/attachment-preview-source/", source)
        self.assertNotIn("attacker", source)
        self.assertNotIn("forceUpdatedCache", params)
        self.assertIn("泊康项目管理系统".encode(), response.content)
        self.assertIn("/preview/", get.call_args.kwargs["headers"]["X-Base-Url"])

    @patch("plane.app.views.attachment_preview.requests.get")
    def test_deleted_asset_does_not_reveal_cached_content(self, get):
        self.asset.is_deleted = True
        self.asset.save()
        self.assertEqual(self.request().status_code, 404)
        get.assert_not_called()

    @patch("plane.app.views.attachment_preview.requests.get")
    def test_service_down_keeps_clear_download_fallback(self, get):
        import requests
        get.side_effect = requests.ConnectionError()
        response = self.request()
        self.assertEqual(response.status_code, 503)
        self.assertIn("下载".encode(), response.content)

    def test_invalid_and_expired_source_ticket_denied(self):
        request = APIRequestFactory().get("/source")
        endpoint = AttachmentPreviewSourceEndpoint.as_view()
        self.assertEqual(endpoint(request, token="invalid", filename="x.md").status_code, 403)
        with patch("django.core.signing.time.time", return_value=1000):
            token = signing.dumps(str(self.asset.id), salt=SOURCE_SALT)
        self.assertEqual(endpoint(request, token=token, filename=f"{self.asset.id.hex}-attachment.md").status_code, 403)

    @patch("plane.app.views.attachment_preview.requests.get")
    def test_media_uses_branded_native_player_without_vendor_portal(self, get):
        self.asset.attributes = {"name": "demo.wav", "type": "audio/wav", "size": 20}
        self.asset.save()
        response = self.request()
        self.assertEqual(response.status_code, 200)
        self.assertIn(b"<audio controls", response.content)
        self.assertNotIn(b"kkFileView", response.content)
        get.assert_not_called()

    @patch("plane.app.views.attachment_preview.requests.get")
    def test_viewer_chinese_locale_and_spreadsheet_branding(self, get):
        result = MagicMock(status_code=200)
        result.headers = {"Content-Type": "text/html"}
        result.text = "<html><head><title>old</title></head><body><script>showinfobar: true</script></body></html>"
        get.return_value = result
        response = self.request()
        self.assertIn(b"showinfobar: false", response.content)
        self.assertIn(b"lang:'zh-CN'", response.content)
