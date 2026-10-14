from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [("db", "0125_artifact_source_project_scope")]

    operations = [
        migrations.AddField(
            model_name="workspace",
            name="appearance",
            field=models.JSONField(blank=True, default=dict),
        ),
    ]
