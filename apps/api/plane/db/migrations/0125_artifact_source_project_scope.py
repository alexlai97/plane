from django.db import migrations, models


def backfill_source_projects(apps, schema_editor):
    Source = apps.get_model("db", "ArtifactSource")
    Issue = apps.get_model("db", "Issue")
    alias = schema_editor.connection.alias
    # Preserve only identities backed by the exact retained Issue. Unknown orphans stay null.
    for source_id, issue_id in Source.objects.using(alias).filter(issue_id__isnull=False).values_list("id", "issue_id").iterator():
        project_id = Issue._base_manager.using(alias).filter(id=issue_id).values_list("project_id", flat=True).first()
        if project_id:
            Source.objects.using(alias).filter(id=source_id).update(project_id=project_id)


class Migration(migrations.Migration):
    dependencies = [("db", "0124_artifact_management")]
    operations = [
        migrations.AddField(
            model_name="artifactsource", name="project_id",
            field=models.UUIDField(editable=False, null=True),
        ),
        migrations.RunPython(backfill_source_projects, migrations.RunPython.noop),
    ]
