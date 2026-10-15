from django.conf import settings
from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [("db", "0126_workspace_appearance"), migrations.swappable_dependency(settings.AUTH_USER_MODEL)]
    operations = [migrations.AddField(model_name="artifact", name="assignees", field=models.ManyToManyField(blank=True, related_name="assigned_artifacts", to=settings.AUTH_USER_MODEL))]
