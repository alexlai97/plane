import uuid
from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):
    dependencies = [("db", "0122_alter_draftissue_assignees_alter_issue_assignees_and_more")]
    operations = [migrations.CreateModel(
        name="WorkItemTemplate",
        fields=[
            ("id", models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False, serialize=False)),
            ("key", models.SlugField(max_length=100, default=uuid.uuid4)),
            ("name", models.CharField(max_length=100)),
            ("description_html", models.TextField(blank=True, default="")),
            ("recommended_member_ids", models.JSONField(default=list)),
            ("is_default", models.BooleanField(default=False)),
            ("version", models.PositiveIntegerField(default=1)),
            ("created_at", models.DateTimeField(auto_now_add=True)),
            ("updated_at", models.DateTimeField(auto_now=True)),
            ("project", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="work_item_templates", to="db.project")),
        ],
        options={"db_table": "work_item_templates", "constraints": [
            models.UniqueConstraint(fields=("project", "key"), name="template_project_key_unique"),
            models.UniqueConstraint(fields=("project",), condition=models.Q(is_default=True), name="template_project_default_unique"),
        ]},
    )]
