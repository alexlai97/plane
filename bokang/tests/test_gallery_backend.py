from uuid import uuid4

import pytest
from plane.db.models import (
    FileAsset,
    Issue,
    IssueComment,
    IssueLink,
    Project,
    ProjectMember,
    State,
    Workspace,
    WorkspaceMember,
)
from rest_framework import status


def make_issue(workspace, project, state, creator, name="Gallery source"):
    return Issue.objects.create(
        name=name,
        workspace=workspace,
        project=project,
        state=state,
        created_by=creator,
    )


def make_asset(workspace, project, issue, creator, name, entity_type, **relations):
    return FileAsset.objects.create(
        attributes={"name": name, "type": "image/png", "size": 1024},
        asset=f"{workspace.id}/{uuid4().hex}-{name}",
        workspace=workspace,
        project=project,
        issue=relations.get("issue", issue),
        comment=relations.get("comment"),
        created_by=creator,
        entity_type=entity_type,
        is_uploaded=True,
        is_deleted=False,
    )


@pytest.fixture
def gallery_graph(db, create_user, workspace):
    project = Project.objects.create(
        name="Gallery project",
        identifier="GAL",
        workspace=workspace,
        created_by=create_user,
    )
    ProjectMember.objects.create(
        project=project, member=create_user, role=20, is_active=True
    )
    state = State.objects.create(
        name="Done",
        project=project,
        workspace=workspace,
        group="completed",
        default=True,
    )
    issue = make_issue(workspace, project, state, create_user)
    attachment = make_asset(
        workspace,
        project,
        issue,
        create_user,
        "proof.pdf",
        FileAsset.EntityTypeContext.ISSUE_ATTACHMENT,
    )
    description_image = make_asset(
        workspace,
        project,
        issue,
        create_user,
        "description.png",
        FileAsset.EntityTypeContext.ISSUE_DESCRIPTION,
    )
    return {
        "workspace": workspace,
        "project": project,
        "state": state,
        "issue": issue,
        "attachment": attachment,
        "description_image": description_image,
    }


def gallery_config(graph):
    issue = graph["issue"]
    return {
        "workspace_id": str(graph["workspace"].id),
        "categories": ["研发"],
        "cards": [
            {
                "key": "source-card",
                "title": "Source card",
                "summary": "A real source task",
                "category": "研发",
                "kind": "document",
                "sources": [str(issue.id)],
                "assets": [
                    {
                        "id": str(graph["attachment"].id),
                        "entity_type": "ISSUE_ATTACHMENT",
                    },
                    {
                        "id": str(graph["description_image"].id),
                        "entity_type": "ISSUE_DESCRIPTION",
                    },
                ],
                "cover_asset_id": str(graph["description_image"].id),
                "links": [],
                "primary_action": {
                    "type": "attachment",
                    "label": "Preview",
                    "attachment_id": str(graph["attachment"].id),
                },
            }
        ],
    }


@pytest.mark.django_db
def test_workspace_gallery_uses_real_issue_and_attachment_metadata(
    session_client, gallery_graph, monkeypatch
):
    from plane.app.views import gallery as gallery_views

    config = gallery_config(gallery_graph)
    monkeypatch.setattr(gallery_views, "load_gallery_config", lambda: config)
    response = session_client.get(
        f"/api/workspaces/{gallery_graph['workspace'].slug}/gallery/"
    )

    assert response.status_code == status.HTTP_200_OK
    body = response.data
    assert body["stats"] == {"total": 1, "with_demo": 0}
    assert (
        body["cards"][0]["sources"][0]["identifier"]
        == f"GAL-{gallery_graph['issue'].sequence_id}"
    )
    attachment = next(
        item
        for item in body["cards"][0]["attachments"]
        if item["id"] == str(gallery_graph["attachment"].id)
    )
    embedded = next(
        item
        for item in body["cards"][0]["attachments"]
        if item["id"] == str(gallery_graph["description_image"].id)
    )
    assert attachment["file_url"].endswith(
        f"/assets/v2/workspaces/{gallery_graph['workspace'].slug}/projects/{gallery_graph['project'].id}/"
        f"issues/{gallery_graph['issue'].id}/attachments/{gallery_graph['attachment'].id}/"
    )
    assert attachment["can_preview"] is True
    assert embedded["file_url"].endswith(
        f"/gallery/assets/{gallery_graph['project'].id}/{gallery_graph['issue'].id}/{gallery_graph['description_image'].id}/"
    )
    assert embedded["source_url"].endswith("/preview/source")
    assert embedded["can_preview"] is True


@pytest.mark.django_db
def test_workspace_gallery_omits_sources_without_project_membership(
    session_client, gallery_graph, monkeypatch
):
    from plane.app.views import gallery as gallery_views

    config = gallery_config(gallery_graph)
    outsider = Project.objects.create(
        name="No access project",
        identifier="NOA",
        workspace=gallery_graph["workspace"],
        created_by=gallery_graph["workspace"].owner,
    )
    inaccessible_issue = make_issue(
        gallery_graph["workspace"],
        outsider,
        gallery_graph["state"],
        gallery_graph["workspace"].owner,
        "Private source",
    )
    config["cards"].append(
        {
            **config["cards"][0],
            "key": "private",
            "sources": [str(inaccessible_issue.id)],
        }
    )
    monkeypatch.setattr(gallery_views, "load_gallery_config", lambda: config)

    response = session_client.get(
        f"/api/workspaces/{gallery_graph['workspace'].slug}/gallery/"
    )

    assert response.status_code == status.HTTP_200_OK
    assert [card["id"] for card in response.data["cards"]] == ["source-card"]


@pytest.mark.django_db
def test_workspace_gallery_omits_cards_without_active_project_membership(
    session_client, gallery_graph, create_user, monkeypatch
):
    from plane.app.views import gallery as gallery_views

    monkeypatch.setattr(
        gallery_views, "load_gallery_config", lambda: gallery_config(gallery_graph)
    )
    ProjectMember.objects.filter(
        project=gallery_graph["project"], member=create_user
    ).update(is_active=False)

    response = session_client.get(
        f"/api/workspaces/{gallery_graph['workspace'].slug}/gallery/"
    )

    assert response.status_code == status.HTTP_200_OK
    assert response.data["cards"] == []


@pytest.mark.django_db
def test_workspace_gallery_verifies_live_external_links_and_primary_action(
    session_client, gallery_graph, monkeypatch
):
    from plane.app.views import gallery as gallery_views

    graph = gallery_graph
    url = "https://example.invalid/demo"
    IssueLink.objects.create(
        workspace=graph["workspace"],
        project=graph["project"],
        issue=graph["issue"],
        created_by=graph["workspace"].owner,
        url="https://example.invalid/other",
    )
    config = gallery_config(graph)
    config["cards"][0]["links"] = [{"title": "Demo", "url": url, "kind": "demo"}]
    config["cards"][0]["primary_action"] = {
        "type": "link",
        "label": "Open demo",
        "url": url,
    }
    monkeypatch.setattr(gallery_views, "load_gallery_config", lambda: config)

    response = session_client.get(f"/api/workspaces/{graph['workspace'].slug}/gallery/")

    assert response.status_code == status.HTTP_200_OK
    card = response.data["cards"][0]
    assert card["links"] == []
    assert card["primary_action"] == {"type": "detail", "label": "查看详情"}

    IssueLink.objects.create(
        workspace=graph["workspace"],
        project=graph["project"],
        issue=graph["issue"],
        created_by=graph["workspace"].owner,
        url=url,
    )
    verified = session_client.get(f"/api/workspaces/{graph['workspace'].slug}/gallery/")
    assert verified.data["cards"][0]["links"] == [
        {
            "title": "Demo",
            "url": url,
            "kind": "demo",
            "issue_id": str(graph["issue"].id),
        }
    ]
    assert verified.data["cards"][0]["primary_action"] == {
        "type": "link",
        "label": "Open demo",
        "url": url,
    }


@pytest.mark.django_db
def test_workspace_gallery_ignores_unuploaded_deleted_and_wrong_workspace_assets(
    session_client, gallery_graph, monkeypatch
):
    from plane.app.views import gallery as gallery_views

    graph = gallery_graph
    config = gallery_config(graph)
    unuploaded = make_asset(
        graph["workspace"],
        graph["project"],
        graph["issue"],
        graph["workspace"].owner,
        "pending.pdf",
        FileAsset.EntityTypeContext.ISSUE_ATTACHMENT,
    )
    unuploaded.is_uploaded = False
    unuploaded.save(update_fields=["is_uploaded"])
    deleted = make_asset(
        graph["workspace"],
        graph["project"],
        graph["issue"],
        graph["workspace"].owner,
        "deleted.pdf",
        FileAsset.EntityTypeContext.ISSUE_ATTACHMENT,
    )
    deleted.is_deleted = True
    deleted.save(update_fields=["is_deleted"])
    other_workspace = Workspace.objects.create(
        name="Other workspace",
        owner=graph["workspace"].owner,
        slug="other-gallery-workspace",
    )
    other_project = Project.objects.create(
        name="Other project",
        identifier="OTH",
        workspace=other_workspace,
        created_by=other_workspace.owner,
    )
    wrong_workspace = make_asset(
        other_workspace,
        other_project,
        graph["issue"],
        other_workspace.owner,
        "wrong-workspace.pdf",
        FileAsset.EntityTypeContext.ISSUE_ATTACHMENT,
    )
    config["cards"][0]["assets"].extend(
        {"id": str(asset.id), "entity_type": "ISSUE_ATTACHMENT"}
        for asset in (unuploaded, deleted, wrong_workspace)
    )
    config["cards"][0]["primary_action"] = {
        "type": "attachment",
        "label": "Download",
        "attachment_id": str(deleted.id),
    }
    monkeypatch.setattr(gallery_views, "load_gallery_config", lambda: config)

    response = session_client.get(f"/api/workspaces/{graph['workspace'].slug}/gallery/")

    assert response.status_code == status.HTTP_200_OK
    card = response.data["cards"][0]
    assert {asset["id"] for asset in card["attachments"]} == {
        str(graph["attachment"].id),
        str(graph["description_image"].id),
    }
    assert card["primary_action"] == {"type": "detail", "label": "查看详情"}


@pytest.mark.django_db
def test_gallery_embedded_image_preview_requires_curated_source_and_image_type(
    session_client, gallery_graph, monkeypatch
):
    from plane.app.views import gallery as gallery_views

    config = gallery_config(gallery_graph)
    monkeypatch.setattr(gallery_views, "load_gallery_config", lambda: config)
    workspace = gallery_graph["workspace"]
    project = gallery_graph["project"]
    issue = gallery_graph["issue"]
    asset = gallery_graph["description_image"]
    path = f"/api/workspaces/{workspace.slug}/gallery/assets/{project.id}/{issue.id}/{asset.id}/preview/onlinePreview"

    response = session_client.get(path)

    assert response.status_code == status.HTTP_200_OK
    assert response["X-Frame-Options"] == "SAMEORIGIN"
    assert response["Cache-Control"] == "private, no-store"
    assert b"description.png" in response.content

    asset.attributes = {
        "name": "description.docx",
        "type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "size": 1024,
    }
    asset.save(update_fields=["attributes"])
    rejected = session_client.get(path)
    assert rejected.status_code == status.HTTP_404_NOT_FOUND


@pytest.mark.django_db
def test_gallery_embedded_asset_preview_is_not_an_unrestricted_asset_proxy(
    session_client, gallery_graph, monkeypatch
):
    from plane.app.views import gallery as gallery_views

    config = gallery_config(gallery_graph)
    monkeypatch.setattr(gallery_views, "load_gallery_config", lambda: config)
    other_asset = make_asset(
        gallery_graph["workspace"],
        gallery_graph["project"],
        gallery_graph["issue"],
        gallery_graph["workspace"].owner,
        "not-curated.png",
        FileAsset.EntityTypeContext.ISSUE_DESCRIPTION,
    )
    path = (
        f"/api/workspaces/{gallery_graph['workspace'].slug}/gallery/assets/"
        f"{gallery_graph['project'].id}/{gallery_graph['issue'].id}/{other_asset.id}/preview/source"
    )

    response = session_client.get(path)

    assert response.status_code == status.HTTP_404_NOT_FOUND


@pytest.mark.django_db
def test_gallery_embedded_asset_preview_rejects_deleted_comment_or_asset(
    session_client, gallery_graph, monkeypatch
):
    from django.utils import timezone
    from plane.app.views import gallery as gallery_views

    graph = gallery_graph
    comment = IssueComment.objects.create(
        workspace=graph["workspace"],
        project=graph["project"],
        issue=graph["issue"],
        actor=graph["workspace"].owner,
        created_by=graph["workspace"].owner,
        comment_html="<p>Screenshot</p>",
    )
    image = make_asset(
        graph["workspace"],
        graph["project"],
        graph["issue"],
        graph["workspace"].owner,
        "comment.png",
        FileAsset.EntityTypeContext.COMMENT_DESCRIPTION,
        comment=comment,
    )
    config = gallery_config(graph)
    config["cards"][0]["assets"].append(
        {"id": str(image.id), "entity_type": "COMMENT_DESCRIPTION"}
    )
    monkeypatch.setattr(gallery_views, "load_gallery_config", lambda: config)
    path = (
        f"/api/workspaces/{graph['workspace'].slug}/gallery/assets/"
        f"{graph['project'].id}/{graph['issue'].id}/{image.id}/preview/source"
    )

    image.is_deleted = True
    image.save(update_fields=["is_deleted"])
    assert session_client.get(path).status_code == status.HTTP_404_NOT_FOUND

    image.is_deleted = False
    image.save(update_fields=["is_deleted"])
    IssueComment.objects.filter(pk=comment.pk).update(deleted_at=timezone.now())
    assert session_client.get(path).status_code == status.HTTP_404_NOT_FOUND


@pytest.mark.django_db
def test_gallery_endpoint_is_workspace_scoped(
    session_client, gallery_graph, monkeypatch
):
    from plane.app.views import gallery as gallery_views

    monkeypatch.setattr(
        gallery_views, "load_gallery_config", lambda: gallery_config(gallery_graph)
    )
    second_workspace = Workspace.objects.create(
        name="Different workspace",
        owner=gallery_graph["workspace"].owner,
        slug="different-workspace",
    )
    WorkspaceMember.objects.create(
        workspace=second_workspace, member=gallery_graph["workspace"].owner, role=20
    )

    response = session_client.get(f"/api/workspaces/{second_workspace.slug}/gallery/")

    assert response.status_code == status.HTTP_404_NOT_FOUND


@pytest.mark.django_db
def test_workspace_gallery_rejects_anonymous_client(api_client, gallery_graph):
    response = api_client.get(
        f"/api/workspaces/{gallery_graph['workspace'].slug}/gallery/"
    )

    assert response.status_code in (
        status.HTTP_401_UNAUTHORIZED,
        status.HTTP_403_FORBIDDEN,
    )
