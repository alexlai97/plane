from plane.api.views.base import BaseAPIView
from plane.app.views.work_item_template import TemplateEndpointMixin


class WorkItemTemplateAPIEndpoint(TemplateEndpointMixin, BaseAPIView):
    pass
