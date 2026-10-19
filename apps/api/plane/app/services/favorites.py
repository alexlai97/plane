"""Batched resolution and authorization for personal favorite targets."""
from collections import defaultdict

from django.db.models import Q

from plane.db.models import (
    Artifact, Cycle, Issue, IssueView, Module, Page, Project, ProjectMember,
    ProjectPage,
)
from plane.app.permissions import ROLE
from plane.app.services.work_item_references import issue_visibility_filter as _issue_visibility_filter


SUPPORTED_ENTITY_TYPES = {"project", "module", "cycle", "page", "view", "workspace_view", "issue", "artifact"}


def _active_project_ids(user, workspace):
    return set(ProjectMember.objects.filter(
        workspace=workspace, member=user, is_active=True, deleted_at__isnull=True,
        project__deleted_at__isnull=True,
    ).values_list("project_id", flat=True))



def favorite_target_is_allowed(user, workspace, entity_type, identifier, project_id=None):
    """Validate a newly selected or reparented favorite target in this workspace."""
    if entity_type not in SUPPORTED_ENTITY_TYPES or not identifier:
        return False
    project_ids = _active_project_ids(user, workspace)
    if project_id:
        if project_id not in project_ids:
            return False
        if not Project.objects.filter(id=project_id, workspace=workspace, deleted_at__isnull=True).exists():
            return False

    if entity_type == "project":
        return bool(project_id and str(project_id) == str(identifier))
    if entity_type in {"issue", "module", "cycle"}:
        model = {"issue": Issue, "module": Module, "cycle": Cycle}[entity_type]
        queryset = model.objects.filter(id=identifier, workspace=workspace, project_id__in=project_ids)
        if project_id and str(project_id) != str(queryset.values_list("project_id", flat=True).first()):
            return False
        if entity_type == "issue":
            queryset = queryset.filter(_issue_visibility_filter(user))
        return queryset.exists()
    if entity_type in {"view", "workspace_view"}:
        view = IssueView.objects.filter(id=identifier, workspace=workspace, archived_at__isnull=True).first()
        if not view or (entity_type == "workspace_view" and view.project_id is not None):
            return False
        if project_id and str(project_id) != str(view.project_id):
            return False
        if view.project_id:
            if view.project_id not in project_ids:
                return False
            project_member = ProjectMember.objects.filter(
                project_id=view.project_id, member=user, workspace=workspace, is_active=True, deleted_at__isnull=True,
            ).select_related("project").first()
            if project_member and project_member.role == ROLE.GUEST.value and not project_member.project.guest_view_all_features:
                return view.owned_by_id == user.id
        return bool(view.owned_by_id == user.id or view.access == 1)
    if entity_type == "page":
        page = Page.objects.filter(id=identifier, workspace=workspace, archived_at__isnull=True).first()
        if not page:
            return False
        linked_projects = set(ProjectPage.objects.filter(
            page=page, deleted_at__isnull=True,
        ).values_list("project_id", flat=True))
        if not project_id or project_id not in linked_projects or project_id not in project_ids:
            return False
        return bool(page.owned_by_id == user.id or page.access == Page.PUBLIC_ACCESS)
    if entity_type == "artifact":
        # Published snapshot authorization also checks frozen source and asset references.
        from plane.app.services.artifacts import published_snapshot
        artifact = Artifact.objects.filter(
            id=identifier, workspace=workspace, deleted_at__isnull=True,
        ).select_related("workspace", "published_revision", "owner").first()
        if not artifact:
            return False
        try:
            return published_snapshot(artifact, user) is not None
        except Exception:
            return False
    return False


def resolve_favorite_targets(favorites, user):
    """Resolve a collection in bounded per-type queries and suppress inaccessible metadata."""
    favorites = list(favorites)
    result = {}
    ids_by_type = defaultdict(set)
    for favorite in favorites:
        if favorite.is_folder:
            result[favorite.id] = {"is_available": True, "entity_data": {"id": str(favorite.id), "name": favorite.name or ""}}
        elif favorite.entity_identifier:
            ids_by_type[favorite.entity_type].add(favorite.entity_identifier)
        else:
            result[favorite.id] = {"is_available": False, "entity_data": None}

    workspace = favorites[0].workspace if favorites else None
    if not workspace:
        return result
    project_ids = _active_project_ids(user, workspace)
    project_members = list(ProjectMember.objects.filter(
        workspace=workspace, member=user, is_active=True, deleted_at__isnull=True,
        project__deleted_at__isnull=True,
    ).values_list("project_id", "role", "project__guest_view_all_features"))
    allowed = {}

    for entity_type in ("issue", "module", "cycle"):
        model = {"issue": Issue, "module": Module, "cycle": Cycle}[entity_type]
        queryset = model.objects.filter(
            id__in=ids_by_type[entity_type], workspace=workspace, project_id__in=project_ids,
        ).select_related("project")
        if entity_type == "issue":
            queryset = queryset.filter(_issue_visibility_filter(user))
        rows = queryset
        for row in rows:
            if entity_type == "issue":
                data = {"id": str(row.id), "name": row.name,
                        "identifier": f"{row.project.identifier}-{row.sequence_id}",
                        "project_identifier": row.project.identifier, "project_id": str(row.project_id),
                        "sequence_id": row.sequence_id}
            else:
                data = {"id": str(row.id), "name": row.name, "project_id": str(row.project_id)}
                if hasattr(row, "logo_props"):
                    data["logo_props"] = row.logo_props
            allowed[(entity_type, row.id)] = data

    for entity_type in ("view", "workspace_view"):
        rows = IssueView.objects.filter(
            id__in=ids_by_type[entity_type], workspace=workspace, archived_at__isnull=True,
        ).filter(Q(owned_by=user) | Q(access=1)).filter(Q(project__isnull=True) | Q(project_id__in=project_ids))
        for row in rows:
            if entity_type == "view" or row.project_id is None:
                if row.project_id:
                    membership = next((item for item in project_members if item[0] == row.project_id), None)
                    if membership and membership[1] == ROLE.GUEST.value and not membership[2] and row.owned_by_id != user.id:
                        continue
                allowed[(entity_type, row.id)] = {"id": str(row.id), "name": row.name, "logo_props": row.logo_props,
                                                    "project_id": str(row.project_id) if row.project_id else None}

    page_rows = Page.objects.filter(id__in=ids_by_type["page"], workspace=workspace, archived_at__isnull=True).prefetch_related("projects")
    for row in page_rows:
        linked = {project.id for project in row.projects.all()}
        if row.owned_by_id == user.id or (row.access == Page.PUBLIC_ACCESS and bool(linked & project_ids)):
            allowed[("page", row.id)] = {"id": str(row.id), "name": row.name,
                                          "project_ids": {str(value) for value in linked & project_ids},
                                          "logo_props": row.logo_props}

    project_rows = Project.objects.filter(
        id__in=ids_by_type["project"] & project_ids, workspace=workspace, deleted_at__isnull=True,
    )
    for row in project_rows:
        allowed[("project", row.id)] = {"id": str(row.id), "name": row.name, "logo_props": row.logo_props}

    if ids_by_type["artifact"]:
        from plane.app.services.artifacts import ArtifactReadContext, artifact_read_queryset, published_snapshot
        rows = list(artifact_read_queryset(Artifact.objects.filter(
            id__in=ids_by_type["artifact"], workspace=workspace, deleted_at__isnull=True,
        ).select_related("workspace", "published_revision", "owner")))
        context = ArtifactReadContext(user, workspace, rows)
        for row in rows:
            try:
                if published_snapshot(row, user, read_context=context) is not None:
                    allowed[("artifact", row.id)] = {"id": str(row.id), "name": row.title}
            except Exception:
                continue

    for favorite in favorites:
        if favorite.is_folder:
            continue
        data = allowed.get((favorite.entity_type, favorite.entity_identifier))
        if data is not None and favorite.entity_type in {"issue", "module", "cycle"}:
            if favorite.project_id and str(favorite.project_id) != data.get("project_id"):
                data = None
        if data is not None and favorite.entity_type == "page":
            if not favorite.project_id or str(favorite.project_id) not in data["project_ids"]:
                data = None
            else:
                data = {key: value for key, value in data.items() if key != "project_ids"}
                data["project_id"] = str(favorite.project_id)
        result[favorite.id] = {"is_available": data is not None, "entity_data": data}
    return result
