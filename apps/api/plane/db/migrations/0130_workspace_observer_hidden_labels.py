from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [("db", "0129_presentations")]
    operations = [migrations.AddField(model_name="workspace", name="observer_hidden_label_ids", field=models.JSONField(default=list, blank=True))]
