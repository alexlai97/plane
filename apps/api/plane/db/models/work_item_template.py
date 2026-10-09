import uuid
from django.db import models


class WorkItemTemplate(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    project = models.ForeignKey("db.Project", on_delete=models.CASCADE, related_name="work_item_templates")
    key = models.SlugField(max_length=100, default=uuid.uuid4)
    name = models.CharField(max_length=100)
    description_html = models.TextField(blank=True, default="")
    recommended_member_ids = models.JSONField(default=list)
    is_default = models.BooleanField(default=False)
    version = models.PositiveIntegerField(default=1)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "work_item_templates"
        constraints = [
            models.UniqueConstraint(fields=["project", "key"], name="template_project_key_unique"),
            models.UniqueConstraint(fields=["project"], condition=models.Q(is_default=True), name="template_project_default_unique"),
        ]
