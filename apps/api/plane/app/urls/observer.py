from django.urls import path

from plane.app.views.observer import SummaryViewListEndpoint, SummaryViewWorkItemsEndpoint

urlpatterns = [
    path("workspaces/<str:slug>/summary/views/", SummaryViewListEndpoint.as_view(), name="summary-views"),
    path("workspaces/<str:slug>/summary/projects/<uuid:project_id>/views/<uuid:view_id>/work-items/", SummaryViewWorkItemsEndpoint.as_view(), name="summary-project-view-work-items"),
    path("workspaces/<str:slug>/summary/views/<uuid:view_id>/work-items/", SummaryViewWorkItemsEndpoint.as_view(), name="summary-view-work-items"),
]
