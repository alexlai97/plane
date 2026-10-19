from rest_framework.response import Response

from plane.app.views.base import BaseAPIView
from plane.utils.access_policy import get_workspace_access_policy


class WorkspaceAccessPolicyEndpoint(BaseAPIView):
    """Return the current user's effective workspace access preset and scope."""

    access_policy_exempt = True

    def get(self, request, slug):
        policy = get_workspace_access_policy(request, slug)
        return Response(policy.as_dict())
