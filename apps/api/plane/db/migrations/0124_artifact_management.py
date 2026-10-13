import uuid

from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):
    dependencies = [("db", "0123_work_item_template"), migrations.swappable_dependency(settings.AUTH_USER_MODEL)]
    operations = [
        migrations.CreateModel(name="ArtifactCategory", fields=[
            ("id", models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)),
            ("created_at", models.DateTimeField(auto_now_add=True)), ("updated_at", models.DateTimeField(auto_now=True)),
            ("name", models.CharField(max_length=120)), ("version", models.PositiveIntegerField(default=1)),
            ("deleted_at", models.DateTimeField(blank=True, null=True)),
            ("workspace", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="artifact_categories", to="db.workspace")),
        ], options={"db_table": "artifact_categories"}),
        migrations.CreateModel(name="Artifact", fields=[
            ("id", models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)),
            ("created_at", models.DateTimeField(auto_now_add=True)), ("updated_at", models.DateTimeField(auto_now=True)),
            ("title", models.CharField(max_length=255)), ("summary", models.TextField(blank=True, default="")),
            ("kind", models.CharField(max_length=80)), ("primary_action", models.JSONField(default=dict)),
            ("version", models.PositiveIntegerField(default=1)), ("status", models.CharField(choices=[("draft", "Draft"), ("published", "Published"), ("withdrawn", "Withdrawn")], default="draft", max_length=16)),
            ("access", models.CharField(choices=[("private", "Private"), ("workspace", "Workspace")], default="private", max_length=16)),
            ("deleted_at", models.DateTimeField(blank=True, null=True)),
            ("category", models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.PROTECT, related_name="artifacts", to="db.artifactcategory")),
            ("cover_asset", models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name="artifact_covers", to="db.fileasset")),
            ("owner", models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name="owned_artifacts", to=settings.AUTH_USER_MODEL)),
            ("workspace", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="artifacts", to="db.workspace")),
        ], options={"db_table": "artifacts"}),
        migrations.CreateModel(name="ArtifactMaterial", fields=[
            ("id", models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)),
            ("created_at", models.DateTimeField(auto_now_add=True)), ("updated_at", models.DateTimeField(auto_now=True)),
            ("title", models.CharField(max_length=255)), ("url", models.URLField(blank=True, max_length=2000, null=True)), ("kind", models.CharField(default="attachment", max_length=40)), ("position", models.PositiveIntegerField(default=0)),
            ("artifact", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="materials", to="db.artifact")),
            ("asset", models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name="artifact_materials", to="db.fileasset")),
        ], options={"db_table": "artifact_materials", "ordering": ("position", "created_at")}),
        migrations.CreateModel(name="ArtifactRevision", fields=[
            ("id", models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)),
            ("created_at", models.DateTimeField(auto_now_add=True)), ("updated_at", models.DateTimeField(auto_now=True)), ("number", models.PositiveIntegerField()), ("snapshot", models.JSONField()),
            ("actor", models.ForeignKey(null=True, on_delete=django.db.models.deletion.SET_NULL, related_name="artifact_revisions", to=settings.AUTH_USER_MODEL)),
            ("artifact", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="revisions", to="db.artifact")),
        ], options={"db_table": "artifact_revisions", "ordering": ("-number",)}),
        migrations.CreateModel(name="ArtifactSource", fields=[
            ("id", models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)),
            ("created_at", models.DateTimeField(auto_now_add=True)), ("updated_at", models.DateTimeField(auto_now=True)),
            ("artifact", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="sources", to="db.artifact")), ("issue", models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name="artifact_sources", to="db.issue")),
        ], options={"db_table": "artifact_sources"}),
        migrations.AddField(model_name="artifact", name="published_revision", field=models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name="published_artifacts", to="db.artifactrevision")),
        migrations.AddConstraint(model_name="artifactcategory", constraint=models.UniqueConstraint(condition=models.Q(deleted_at__isnull=True), fields=("workspace", "name"), name="artifact_category_workspace_name_unique")),
        migrations.AddConstraint(model_name="artifactsource", constraint=models.UniqueConstraint(fields=("artifact", "issue"), name="artifact_source_unique")),
        migrations.AddConstraint(model_name="artifactrevision", constraint=models.UniqueConstraint(fields=("artifact", "number"), name="artifact_revision_number_unique")),
        migrations.AddIndex(model_name="artifact", index=models.Index(fields=["workspace", "status", "deleted_at"], name="artifact_ws_status_idx")),
    ]
