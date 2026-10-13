import pytest

from plane.db.models import Artifact


pytestmark = pytest.mark.django_db


def test_artifact_draft_publish_isolated_and_versioned(session_client, workspace):
    base = f"/api/workspaces/{workspace.slug}/artifacts/"
    payload = {
        "title": "可维护成果", "summary": "首版", "kind": "系统",
        "source_issue_ids": [], "assets": [],
        "links": [{"title": "演示", "url": "https://example.org/demo", "kind": "demo"}],
        "primary_action": {"type": "link", "label": "打开演示", "url": "https://example.org/demo"},
    }
    created = session_client.post(base, payload, format="json")
    assert created.status_code == 201, created.data
    artifact_id = created.data["id"]
    assert session_client.get(base).data["count"] == 0

    missing_version = session_client.patch(base + artifact_id + "/", {**payload, "summary": "改稿"}, format="json")
    assert missing_version.status_code == 400
    saved = session_client.patch(base + artifact_id + "/", {**payload, "summary": "改稿", "version": 1}, format="json")
    assert saved.status_code == 200, saved.data
    assert saved.data["version"] == 2

    stale = session_client.patch(base + artifact_id + "/", {**payload, "version": 1}, format="json")
    assert stale.status_code == 409
    published = session_client.post(base + artifact_id + "/publish/", {"version": 2}, format="json")
    assert published.status_code == 200, published.data
    revision_id = Artifact.objects.get(id=artifact_id).published_revision_id

    listed = session_client.get(base)
    assert listed.status_code == 200
    assert listed.data["count"] == 1
    assert listed.data["results"][0]["summary"] == "改稿"

    edit = session_client.patch(base + artifact_id + "/", {**payload, "summary": "后续草稿", "version": 3}, format="json")
    assert edit.status_code == 200
    detail = session_client.get(base + artifact_id + "/")
    assert detail.status_code == 200
    assert detail.data["summary"] == "改稿"
    assert detail.data["has_unpublished_changes"] is True

    withdrawn = session_client.post(base + artifact_id + "/withdraw/", {"version": 4}, format="json")
    assert withdrawn.status_code == 200
    assert session_client.get(base).data["count"] == 0
    assert revision_id
