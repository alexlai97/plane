import uuid
from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):
    dependencies = [("db", "0127_artifact_assignees"), migrations.swappable_dependency(settings.AUTH_USER_MODEL)]

    operations = [
        migrations.AddField(
            model_name="workspacemember",
            name="access_profile",
            field=models.CharField(db_index=True, default="standard", max_length=64),
        ),
        migrations.CreateModel(
            name="WorkspaceMemberProjectGrant",
            fields=[
                ("created_at", models.DateTimeField(auto_now_add=True, verbose_name="Created At")),
                ("updated_at", models.DateTimeField(auto_now=True, verbose_name="Last Modified At")),
                ("deleted_at", models.DateTimeField(blank=True, null=True, verbose_name="Deleted At")),
                ("id", models.UUIDField(db_index=True, default=uuid.uuid4, editable=False, primary_key=True, serialize=False, unique=True)),
                ("created_by", models.ForeignKey(null=True, on_delete=django.db.models.deletion.SET_NULL, related_name="%(class)s_created_by", to=settings.AUTH_USER_MODEL, verbose_name="Created By")),
                ("updated_by", models.ForeignKey(null=True, on_delete=django.db.models.deletion.SET_NULL, related_name="%(class)s_updated_by", to=settings.AUTH_USER_MODEL, verbose_name="Last Modified By")),
                ("workspace_member", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="project_grants", to="db.workspacemember")),
                ("project", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="workspace_access_grants", to="db.project")),
            ],
            options={"db_table": "workspace_member_project_grants", "abstract": False},
        ),
        migrations.CreateModel(
            name="WorkspaceMemberViewGrant",
            fields=[
                ("created_at", models.DateTimeField(auto_now_add=True, verbose_name="Created At")),
                ("updated_at", models.DateTimeField(auto_now=True, verbose_name="Last Modified At")),
                ("deleted_at", models.DateTimeField(blank=True, null=True, verbose_name="Deleted At")),
                ("id", models.UUIDField(db_index=True, default=uuid.uuid4, editable=False, primary_key=True, serialize=False, unique=True)),
                ("created_by", models.ForeignKey(null=True, on_delete=django.db.models.deletion.SET_NULL, related_name="%(class)s_created_by", to=settings.AUTH_USER_MODEL, verbose_name="Created By")),
                ("updated_by", models.ForeignKey(null=True, on_delete=django.db.models.deletion.SET_NULL, related_name="%(class)s_updated_by", to=settings.AUTH_USER_MODEL, verbose_name="Last Modified By")),
                ("workspace_member", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="view_grants", to="db.workspacemember")),
                ("view", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="workspace_access_grants", to="db.issueview")),
            ],
            options={"db_table": "workspace_member_view_grants", "abstract": False},
        ),
        migrations.AddConstraint(
            model_name="workspacememberprojectgrant",
            constraint=models.UniqueConstraint(condition=models.Q(deleted_at__isnull=True), fields=("workspace_member", "project"), name="uniq_workspace_member_project_grant"),
        ),
        migrations.AddConstraint(
            model_name="workspacememberviewgrant",
            constraint=models.UniqueConstraint(condition=models.Q(deleted_at__isnull=True), fields=("workspace_member", "view"), name="uniq_workspace_member_view_grant"),
        ),
    ]
