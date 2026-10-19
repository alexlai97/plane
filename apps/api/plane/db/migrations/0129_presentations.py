import uuid

from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):
    dependencies = [("db", "0128_workspace_member_access_profiles"), migrations.swappable_dependency(settings.AUTH_USER_MODEL)]

    operations = [
        migrations.CreateModel(name="Presentation", fields=[
            ("id", models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)),
            ("created_at", models.DateTimeField(auto_now_add=True)), ("updated_at", models.DateTimeField(auto_now=True)),
            ("title", models.CharField(max_length=255)), ("document", models.JSONField(default=dict)),
            ("version", models.PositiveIntegerField(default=1)), ("deleted_at", models.DateTimeField(blank=True, null=True)),
            ("owner", models.ForeignKey(null=True, on_delete=django.db.models.deletion.SET_NULL, related_name="owned_presentations", to=settings.AUTH_USER_MODEL)),
            ("project", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="presentations", to="db.project")),
            ("workspace", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="presentations", to="db.workspace")),
        ], options={"db_table": "presentations"}),
        migrations.CreateModel(name="PresentationRevision", fields=[
            ("id", models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)),
            ("created_at", models.DateTimeField(auto_now_add=True)), ("number", models.PositiveIntegerField()), ("snapshot", models.JSONField()),
            ("actor", models.ForeignKey(null=True, on_delete=django.db.models.deletion.SET_NULL, related_name="presentation_revisions", to=settings.AUTH_USER_MODEL)),
            ("presentation", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="revisions", to="db.presentation")),
        ], options={"db_table": "presentation_revisions", "ordering": ("-number",)}),
        migrations.AddField(model_name="presentation", name="published_revision", field=models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name="published_presentations", to="db.presentationrevision")),
        migrations.AddIndex(model_name="presentation", index=models.Index(fields=["workspace", "project", "deleted_at"], name="presentation_scope_idx")),
        migrations.AddConstraint(model_name="presentationrevision", constraint=models.UniqueConstraint(fields=("presentation", "number"), name="presentation_revision_number_unique")),
    ]
