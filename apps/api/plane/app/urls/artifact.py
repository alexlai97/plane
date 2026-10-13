from django.urls import path

from plane.app.views.artifact import (
    ArtifactCategoryEndpoint, ArtifactEndpoint, ArtifactRevisionEndpoint, ArtifactSourceEndpoint, ArtifactUploadEndpoint,
    APIKeyArtifactCategoryEndpoint, APIKeyArtifactEndpoint, APIKeyArtifactRevisionEndpoint,
    APIKeyArtifactSourceEndpoint, APIKeyArtifactUploadEndpoint,
)
from plane.app.views.gallery import ArtifactAssetEndpoint, ArtifactCoverEndpoint


def routes(prefix, view, key_view=None):
    return [
        path(prefix, view.as_view(), name="artifact-list"),
        path(prefix + "<uuid:pk>/", view.as_view(), name="artifact-detail"),
    ]


urlpatterns = [
    path("workspaces/<str:slug>/artifacts/", ArtifactEndpoint.as_view(), name="artifact-list"),
    path("workspaces/<str:slug>/artifacts/<uuid:pk>/", ArtifactEndpoint.as_view(), name="artifact-detail"),
    path("workspaces/<str:slug>/artifacts/<uuid:pk>/publish/", ArtifactEndpoint.as_view(), {"action": "publish"}, name="artifact-publish"),
    path("workspaces/<str:slug>/artifacts/<uuid:pk>/withdraw/", ArtifactEndpoint.as_view(), {"action": "withdraw"}, name="artifact-withdraw"),
    path("workspaces/<str:slug>/artifacts/<uuid:pk>/revisions/", ArtifactRevisionEndpoint.as_view(), name="artifact-revisions"),
    path("workspaces/<str:slug>/artifacts/<uuid:pk>/revisions/<uuid:revision_id>/", ArtifactRevisionEndpoint.as_view(), name="artifact-revision"),
    path("workspaces/<str:slug>/artifacts/<uuid:pk>/revisions/<uuid:revision_id>/restore/", ArtifactEndpoint.as_view(), {"action": "restore"}, name="artifact-restore"),
    path("workspaces/<str:slug>/artifact-categories/", ArtifactCategoryEndpoint.as_view(), name="artifact-categories"),
    path("workspaces/<str:slug>/artifact-categories/<uuid:pk>/", ArtifactCategoryEndpoint.as_view(), name="artifact-category"),
    path("workspaces/<str:slug>/artifact-sources/", ArtifactSourceEndpoint.as_view(), name="artifact-sources"),
    path("workspaces/<str:slug>/artifact-sources/<uuid:pk>/materials/", ArtifactSourceEndpoint.as_view(), name="artifact-source-materials"),
    path("workspaces/<str:slug>/artifacts/<uuid:pk>/uploads/", ArtifactUploadEndpoint.as_view(), name="artifact-upload"),
    path("workspaces/<str:slug>/artifacts/<uuid:pk>/assets/<uuid:asset_id>/", ArtifactAssetEndpoint.as_view(), name="artifact-asset"),
    path("workspaces/<str:slug>/artifacts/<uuid:pk>/assets/<uuid:asset_id>/draft/", ArtifactAssetEndpoint.as_view(), {"view": "draft"}, name="artifact-draft-asset"),
    path("workspaces/<str:slug>/artifacts/<uuid:pk>/assets/<uuid:asset_id>/draft/source/", ArtifactAssetEndpoint.as_view(), {"view": "draft", "resource": "source"}, name="artifact-draft-asset-source"),
    path("workspaces/<str:slug>/artifacts/<uuid:pk>/assets/<uuid:asset_id>/draft/preview/<path:resource>", ArtifactAssetEndpoint.as_view(), {"view": "draft"}, name="artifact-draft-asset-preview"),
    path("workspaces/<str:slug>/artifacts/<uuid:pk>/assets/<uuid:asset_id>/<str:resource>/", ArtifactAssetEndpoint.as_view(), name="artifact-asset-source"),
    path("workspaces/<str:slug>/artifacts/<uuid:pk>/assets/<uuid:asset_id>/preview/<path:resource>", ArtifactAssetEndpoint.as_view(), name="artifact-asset-preview"),
    path("workspaces/<str:slug>/artifacts/<uuid:pk>/covers/<uuid:asset_id>/", ArtifactCoverEndpoint.as_view(), name="artifact-cover"),
]

api_urlpatterns = [
    path("workspaces/<str:slug>/artifacts/", APIKeyArtifactEndpoint.as_view(), name="api-artifact-list"),
    path("workspaces/<str:slug>/artifacts/<uuid:pk>/", APIKeyArtifactEndpoint.as_view(), name="api-artifact-detail"),
    path("workspaces/<str:slug>/artifacts/<uuid:pk>/publish/", APIKeyArtifactEndpoint.as_view(), {"action": "publish"}, name="api-artifact-publish"),
    path("workspaces/<str:slug>/artifacts/<uuid:pk>/withdraw/", APIKeyArtifactEndpoint.as_view(), {"action": "withdraw"}, name="api-artifact-withdraw"),
    path("workspaces/<str:slug>/artifacts/<uuid:pk>/revisions/", APIKeyArtifactRevisionEndpoint.as_view(), name="api-artifact-revisions"),
    path("workspaces/<str:slug>/artifacts/<uuid:pk>/revisions/<uuid:revision_id>/", APIKeyArtifactRevisionEndpoint.as_view(), name="api-artifact-revision"),
    path("workspaces/<str:slug>/artifacts/<uuid:pk>/revisions/<uuid:revision_id>/restore/", APIKeyArtifactEndpoint.as_view(), {"action": "restore"}, name="api-artifact-restore"),
    path("workspaces/<str:slug>/artifact-categories/", APIKeyArtifactCategoryEndpoint.as_view(), name="api-artifact-categories"),
    path("workspaces/<str:slug>/artifact-categories/<uuid:pk>/", APIKeyArtifactCategoryEndpoint.as_view(), name="api-artifact-category"),
    path("workspaces/<str:slug>/artifact-sources/", APIKeyArtifactSourceEndpoint.as_view(), name="api-artifact-sources"),
    path("workspaces/<str:slug>/artifact-sources/<uuid:pk>/materials/", APIKeyArtifactSourceEndpoint.as_view(), name="api-artifact-source-materials"),
    path("workspaces/<str:slug>/artifacts/<uuid:pk>/uploads/", APIKeyArtifactUploadEndpoint.as_view(), name="api-artifact-upload"),
]
