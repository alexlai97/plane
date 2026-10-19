"""Live, permission-scoped work item references for cross-page navigation."""
from urllib.parse import quote

from django.db.models import Q

from plane.app.permissions import ROLE
from plane.utils.access_policy import STANDARD
from plane.db.models import Issue, WorkspaceMember


def issue_visibility_filter(user):
    return Q(
        Q(project__project_projectmember__role__gt=ROLE.GUEST.value)
        | Q(project__project_projectmember__role=ROLE.GUEST.value, project__guest_view_all_features=True)
        | Q(project__project_projectmember__role=ROLE.GUEST.value, project__guest_view_all_features=False, created_by=user),
        project__project_projectmember__member=user,
        project__project_projectmember__is_active=True,
        project__project_projectmember__deleted_at__isnull=True,
    )


def resolve_work_item_references(user, workspace, identifiers, project_id=None):
    """Resolve in one batch; inaccessible/deleted IDs retain no metadata or URL."""
    identifiers = list(dict.fromkeys(str(value) for value in identifiers))
    result = {value: {"id": value, "is_available": False} for value in identifiers}
    if not identifiers or not WorkspaceMember.objects.filter(
        workspace=workspace, member=user, is_active=True, deleted_at__isnull=True,
        access_profile=STANDARD,
    ).exists():
        return result
    visible = Issue.objects.filter(
        workspace=workspace, deleted_at__isnull=True,
        project__workspace=workspace, project__deleted_at__isnull=True,
    ).filter(issue_visibility_filter(user)).select_related("project").distinct()
    if project_id is not None:
        visible = visible.filter(project_id=project_id)
    issues = list(visible.filter(id__in=identifiers))
    known = {str(issue.id): issue for issue in issues}
    pending = {str(issue.parent_id) for issue in issues if issue.parent_id} - known.keys()
    # Resolve ancestors by level, never one query per item; cycles terminate through known IDs.
    attempted = set(known)
    while pending:
        attempted.update(pending)
        parents = list(visible.filter(id__in=pending))
        known.update({str(parent.id): parent for parent in parents})
        pending = {str(parent.parent_id) for parent in parents if parent.parent_id} - attempted
    for issue in issues:
        ancestors, seen, parent_id = [], {str(issue.id)}, issue.parent_id
        while parent_id and str(parent_id) in known and str(parent_id) not in seen:
            parent = known[str(parent_id)]
            if parent.project_id != issue.project_id:
                break
            seen.add(str(parent_id))
            ancestors.insert(0, parent.name)
            parent_id = parent.parent_id
        identifier = f"{issue.project.identifier}-{issue.sequence_id}"
        slug = quote(workspace.slug, safe="")
        url = (f"/{slug}/projects/{issue.project_id}/archives/issues/{issue.id}"
               if issue.archived_at else f"/{slug}/browse/{quote(identifier, safe='')}")
        result[str(issue.id)] = {
            "id": str(issue.id), "identifier": identifier, "name": issue.name,
            "project_id": str(issue.project_id), "url": url, "context": " / ".join(ancestors),
            "is_available": True, "is_archived": issue.archived_at is not None,
        }
    return result
