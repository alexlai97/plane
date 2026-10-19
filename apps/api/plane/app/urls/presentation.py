from django.urls import path

from plane.app.views.presentation import PresentationEndpoint, PresentationAssetEndpoint, APIKeyPresentationEndpoint


urlpatterns = [
    path("workspaces/<str:slug>/presentations/", PresentationEndpoint.as_view(), name="presentation-list"),
    path("workspaces/<str:slug>/presentations/<uuid:pk>/", PresentationEndpoint.as_view(), name="presentation-detail"),
    path("workspaces/<str:slug>/presentations/<uuid:pk>/publish/", PresentationEndpoint.as_view(), {"action": "publish"}, name="presentation-publish"),
    path("workspaces/<str:slug>/presentations/<uuid:pk>/assets/<uuid:asset_id>/", PresentationAssetEndpoint.as_view(), name="presentation-asset"),
    path("workspaces/<str:slug>/presentations/<uuid:pk>/assets/<uuid:asset_id>/preview/<path:resource>", PresentationAssetEndpoint.as_view(), name="presentation-asset-preview"),
]

api_urlpatterns = [
    path("workspaces/<str:slug>/presentations/", APIKeyPresentationEndpoint.as_view(), name="api-presentation-list"),
    path("workspaces/<str:slug>/presentations/<uuid:pk>/", APIKeyPresentationEndpoint.as_view(), name="api-presentation-detail"),
    path("workspaces/<str:slug>/presentations/<uuid:pk>/publish/", APIKeyPresentationEndpoint.as_view(), {"action": "publish"}, name="api-presentation-publish"),
]
