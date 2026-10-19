import uuid

from django.conf import settings
from django.db import models


class Presentation(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    workspace = models.ForeignKey("db.Workspace", on_delete=models.CASCADE, related_name="presentations")
    project = models.ForeignKey("db.Project", on_delete=models.CASCADE, related_name="presentations")
    owner = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, on_delete=models.SET_NULL, related_name="owned_presentations")
    title = models.CharField(max_length=255)
    document = models.JSONField(default=dict)
    version = models.PositiveIntegerField(default=1)
    published_revision = models.ForeignKey("db.PresentationRevision", null=True, blank=True, on_delete=models.SET_NULL, related_name="published_presentations")
    deleted_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        db_table = "presentations"
        indexes = [models.Index(fields=("workspace", "project", "deleted_at"), name="presentation_scope_idx")]


class PresentationRevision(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    created_at = models.DateTimeField(auto_now_add=True)
    presentation = models.ForeignKey(Presentation, on_delete=models.CASCADE, related_name="revisions")
    number = models.PositiveIntegerField()
    snapshot = models.JSONField()
    actor = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, on_delete=models.SET_NULL, related_name="presentation_revisions")

    class Meta:
        db_table = "presentation_revisions"
        constraints = [models.UniqueConstraint(fields=("presentation", "number"), name="presentation_revision_number_unique")]
        ordering = ("-number",)
