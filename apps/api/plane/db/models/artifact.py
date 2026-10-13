import uuid

from django.conf import settings
from django.db import models

class ArtifactCategory(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    workspace = models.ForeignKey("db.Workspace", on_delete=models.CASCADE, related_name="artifact_categories")
    name = models.CharField(max_length=120)
    version = models.PositiveIntegerField(default=1)
    deleted_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        db_table = "artifact_categories"
        constraints = [models.UniqueConstraint(fields=("workspace", "name"), condition=models.Q(deleted_at__isnull=True), name="artifact_category_workspace_name_unique")]


class Artifact(models.Model):
    class Access(models.TextChoices):
        PRIVATE = "private"
        WORKSPACE = "workspace"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    class Status(models.TextChoices):
        DRAFT = "draft"
        PUBLISHED = "published"
        WITHDRAWN = "withdrawn"

    workspace = models.ForeignKey("db.Workspace", on_delete=models.CASCADE, related_name="artifacts")
    owner = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name="owned_artifacts")
    title = models.CharField(max_length=255)
    summary = models.TextField(blank=True, default="")
    kind = models.CharField(max_length=80)
    category = models.ForeignKey(ArtifactCategory, null=True, blank=True, on_delete=models.PROTECT, related_name="artifacts")
    cover_asset = models.ForeignKey("db.FileAsset", null=True, blank=True, on_delete=models.SET_NULL, related_name="artifact_covers")
    primary_action = models.JSONField(default=dict)
    version = models.PositiveIntegerField(default=1)
    published_revision = models.ForeignKey("db.ArtifactRevision", null=True, blank=True, on_delete=models.SET_NULL, related_name="published_artifacts")
    status = models.CharField(max_length=16, choices=Status.choices, default=Status.DRAFT)
    access = models.CharField(max_length=16, choices=Access.choices, default=Access.PRIVATE)
    deleted_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        db_table = "artifacts"
        indexes = [models.Index(fields=("workspace", "status", "deleted_at"), name="artifact_ws_status_idx")]


class ArtifactSource(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    artifact = models.ForeignKey(Artifact, on_delete=models.CASCADE, related_name="sources")
    issue = models.ForeignKey("db.Issue", null=True, blank=True, on_delete=models.SET_NULL, related_name="artifact_sources")

    class Meta:
        db_table = "artifact_sources"
        constraints = [models.UniqueConstraint(fields=("artifact", "issue"), name="artifact_source_unique")]


class ArtifactMaterial(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    artifact = models.ForeignKey(Artifact, on_delete=models.CASCADE, related_name="materials")
    asset = models.ForeignKey("db.FileAsset", null=True, blank=True, on_delete=models.SET_NULL, related_name="artifact_materials")
    title = models.CharField(max_length=255)
    url = models.URLField(max_length=2000, null=True, blank=True)
    kind = models.CharField(max_length=40, default="attachment")
    position = models.PositiveIntegerField(default=0)

    class Meta:
        db_table = "artifact_materials"
        ordering = ("position", "created_at")


class ArtifactRevision(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    artifact = models.ForeignKey(Artifact, on_delete=models.CASCADE, related_name="revisions")
    number = models.PositiveIntegerField()
    snapshot = models.JSONField()
    actor = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, on_delete=models.SET_NULL, related_name="artifact_revisions")

    class Meta:
        db_table = "artifact_revisions"
        constraints = [models.UniqueConstraint(fields=("artifact", "number"), name="artifact_revision_number_unique")]
        ordering = ("-number",)
