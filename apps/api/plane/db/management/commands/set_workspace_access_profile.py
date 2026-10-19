"""Apply a predefined access ceiling and explicit resource grants to a member."""
from django.core.management.base import BaseCommand, CommandError
from django.core.exceptions import ValidationError
from django.db import transaction
from plane.db.models import (
    Project, ProjectMember, IssueView, WorkspaceMember,
    WorkspaceMemberProjectGrant, WorkspaceMemberViewGrant,
)
from plane.utils.access_policy import PROFILE_CAPABILITIES, STANDARD


class Command(BaseCommand):
    help = "Replace an active workspace member's access preset and explicit scope (no role escalation)."

    def add_arguments(self, parser):
        parser.add_argument("--workspace", required=True)
        parser.add_argument("--email", required=True)
        parser.add_argument("--profile", required=True, choices=sorted(PROFILE_CAPABILITIES))
        parser.add_argument("--project", action="append", default=[])
        parser.add_argument("--view", action="append", default=[])
        parser.add_argument("--dry-run", action="store_true")

    @transaction.atomic
    def handle(self, *args, **options):
        member = WorkspaceMember.objects.select_for_update().filter(
            workspace__slug=options["workspace"], member__email__iexact=options["email"],
            is_active=True, deleted_at__isnull=True,
        ).first()
        if member is None:
            raise CommandError("An active workspace membership is required.")
        project_ids, view_ids = set(options["project"]), set(options["view"])
        if options["profile"] == STANDARD and (project_ids or view_ids):
            raise CommandError("Standard profile uses existing role permissions; omit explicit scopes.")
        try:
            projects = Project.objects.filter(id__in=project_ids, workspace_id=member.workspace_id)
            views = IssueView.objects.filter(id__in=view_ids, workspace_id=member.workspace_id, access=1)
            valid_projects = {str(p.id) for p in projects}
            valid_views = {str(v.id) for v in views}
        except (ValueError, TypeError, ValidationError) as exc:
            raise CommandError("Scope values must be valid resource UUIDs.") from exc
        if project_ids != valid_projects or view_ids != valid_views:
            raise CommandError("Scope contains missing, private, deleted, or cross-workspace resources.")
        if any(v.project_id and str(v.project_id) not in project_ids for v in views):
            raise CommandError("Every project view must also have its project explicitly granted.")
        memberships = set(str(v) for v in ProjectMember.objects.filter(
            project_id__in=project_ids, member_id=member.member_id, is_active=True,
            deleted_at__isnull=True,
        ).values_list("project_id", flat=True))
        if memberships != project_ids:
            raise CommandError("Active project memberships are required before applying scope grants.")
        if options["dry_run"]:
            self.stdout.write(f"Validated: {options['profile']}; {len(project_ids)} projects, {len(view_ids)} shared views. No changes.")
            return
        member.project_grants.all().delete()
        member.view_grants.all().delete()
        WorkspaceMemberProjectGrant.objects.bulk_create([
            WorkspaceMemberProjectGrant(workspace_member=member, project=p) for p in projects
        ])
        WorkspaceMemberViewGrant.objects.bulk_create([
            WorkspaceMemberViewGrant(workspace_member=member, view=v) for v in views
        ])
        member.access_profile = options["profile"]
        member.save(update_fields=["access_profile", "updated_at"])
        self.stdout.write(self.style.SUCCESS(
            f"Applied {options['profile']}; {len(project_ids)} projects, {len(view_ids)} shared views. Existing numeric roles unchanged."
        ))
