"""Explicit one-time attribution from linked work, without changing business permissions."""
import json
from django.core.management.base import BaseCommand, CommandError
from django.db import transaction
from plane.db.models import Artifact, User, Workspace
from plane.app.services.artifacts.service import (
    source_assignee_ids, serialize_artifact, update_artifact, publish_artifact, require_artifact_write,
)


class Command(BaseCommand):
    help = "Fill empty artifact assignees from active source-task assignments. Dry-run by default."

    def add_arguments(self, parser):
        parser.add_argument('--workspace', required=True)
        parser.add_argument('--actor', required=True, help='Active workspace maintainer UUID')
        parser.add_argument('--apply', action='store_true')

    @transaction.atomic
    def handle(self, *args, **options):
        try:
            workspace = Workspace.objects.get(slug=options['workspace'], deleted_at__isnull=True)
            actor = User.objects.get(id=options['actor'], is_active=True)
        except (Workspace.DoesNotExist, User.DoesNotExist, ValueError) as exc:
            raise CommandError(str(exc))
        rows = []
        for obj in Artifact.objects.select_for_update(of=("self",)).filter(workspace=workspace, deleted_at__isnull=True).select_related('published_revision').order_by('title', 'id'):
            require_artifact_write(actor, obj)
            current = serialize_artifact(obj, actor, 'draft')
            entry = {'id': str(obj.id), 'title': obj.title, 'before': current['assignee_ids']}
            sources = [row.issue for row in obj.sources.select_related('issue') if row.issue and row.issue.deleted_at is None]
            ids = sorted({value for issue in sources for value in source_assignee_ids(issue)})
            entry.update({'suggested': ids, 'source_issue_ids': [str(issue.id) for issue in sources]})
            if obj.status != Artifact.Status.PUBLISHED:
                entry['action'] = 'skip-not-published'
            elif current['assignee_ids']:
                entry['action'] = 'skip-existing'
            elif current['has_unpublished_changes']:
                entry['action'] = 'skip-unpublished-changes'
            elif not ids:
                entry['action'] = 'needs-review'
            else:
                entry['action'] = 'fill'
                if options['apply']:
                    obj = update_artifact(actor, obj, {'version': obj.version, 'assignee_ids': ids})
                    if obj.status == Artifact.Status.PUBLISHED:
                        obj = publish_artifact(actor, obj, obj.version)
            rows.append(entry)
        self.stdout.write(json.dumps({'applied': options['apply'], 'results': rows}, ensure_ascii=False))
