"""Read-only observer projections for explicitly granted saved views."""
from django.db.models import Q, Prefetch
from django.shortcuts import get_object_or_404
from rest_framework.exceptions import PermissionDenied
from rest_framework.response import Response

from plane.app.views.base import BaseAPIView
from plane.db.models import Issue, IssueAssignee, IssueView, ProjectMember, Workspace
from plane.utils.filters import ComplexFilterBackend, IssueFilterSet
from plane.utils.issue_filters import issue_filters
from plane.utils.order_queryset import VIEW_ORDER_BY_ALLOWLIST, order_issue_queryset, sanitize_order_by


class SummaryViewListEndpoint(BaseAPIView):
    access_policy_capability = "view.summary.read"

    def get(self, request, slug):
        workspace = get_object_or_404(Workspace, slug=slug, deleted_at__isnull=True)
        from plane.utils.access_policy import get_workspace_access_policy
        policy = get_workspace_access_policy(request, slug)
        # Grants are authoritative: do not enumerate views and then redact.
        grant_ids = policy.allowed_view_ids
        queryset = IssueView.objects.filter(workspace=workspace).select_related("project").order_by("name", "id")
        if grant_ids is not None:
            queryset = queryset.filter(id__in=grant_ids)
        else:
            queryset = queryset.filter(Q(owned_by=request.user) | Q(access=1)).filter(
                Q(project__isnull=True)
                | Q(
                    project__project_projectmember__member=request.user,
                    project__project_projectmember__is_active=True,
                    project__project_projectmember__deleted_at__isnull=True,
                )
            )
            queryset = queryset.exclude(
                Q(
                    project__project_projectmember__member=request.user,
                    project__project_projectmember__role=5,
                    project__guest_view_all_features=False,
                )
                & ~Q(owned_by=request.user)
            )
        results = []
        for view in queryset:
            try:
                policy.require("view.summary.read", project_id=view.project_id, view_id=view.id)
            except PermissionDenied:
                continue
            results.append({
                "id": str(view.id),
                "project_id": str(view.project_id) if view.project_id else None,
                "project_identifier": view.project.identifier if view.project_id else None,
                "project_name": view.project.name if view.project_id else None,
                "name": view.name,
                "display_filters": _safe_display_filters(view.display_filters),
            })
        return Response({"results": results})


class SummaryViewWorkItemsEndpoint(BaseAPIView):
    access_policy_capability = "view.summary.read"
    filterset_class = IssueFilterSet

    def get(self, request, slug, view_id, project_id=None):
        workspace = get_object_or_404(Workspace, slug=slug, deleted_at__isnull=True)
        view = get_object_or_404(IssueView.objects.select_related("project"), id=view_id, workspace=workspace)
        if project_id is not None and str(view.project_id) != str(project_id):
            from rest_framework.exceptions import NotFound
            raise NotFound()
        from plane.utils.access_policy import get_workspace_access_policy
        policy = get_workspace_access_policy(request, slug)
        if not policy.is_restricted and view.owned_by_id != request.user.id and view.access != 1:
            from rest_framework.exceptions import NotFound
            raise NotFound()
        policy.require("view.summary.read", project_id=view.project_id, view_id=view.id)
        policy.require("work_item.summary.read", project_id=view.project_id, view_id=view.id)
        if not policy.is_restricted and view.project_id:
            membership = ProjectMember.objects.filter(
                project_id=view.project_id, workspace=workspace, member=request.user,
                is_active=True, deleted_at__isnull=True,
            ).first()
            if membership is None:
                from rest_framework.exceptions import NotFound
                raise NotFound()
            if membership.role == 5 and not view.project.guest_view_all_features and view.owned_by_id != request.user.id:
                from rest_framework.exceptions import NotFound
                raise NotFound()

        queryset = Issue.issue_objects.filter(workspace=workspace)
        if view.project_id:
            queryset = queryset.filter(project_id=view.project_id)
        elif policy.allowed_project_ids is not None:
            queryset = queryset.filter(project_id__in=policy.allowed_project_ids)
        else:
            # Observer policies always use explicit project grants; fail closed if
            # the policy implementation returns no project boundary.
            queryset = queryset.none()
        queryset = queryset.filter(state__deleted_at__isnull=True)
        # Saved filters are applied server-side. Request filters are deliberately ignored.
        legacy = issue_filters(view.filters or {}, "GET")
        queryset = queryset.filter(**legacy)
        queryset = ComplexFilterBackend().filter_queryset(
            request, queryset, self, filter_data=view.rich_filters or {}
        )
        # Preserve active project membership for every profile. The observer's
        # policy further intersects it with explicit project and view grants.
        membership_scope = Q(
            project__project_projectmember__member=request.user,
            project__project_projectmember__is_active=True,
            project__project_projectmember__deleted_at__isnull=True,
        )
        if not policy.is_restricted:
            membership_scope &= (
                Q(project__project_projectmember__role__gt=5)
                | Q(project__project_projectmember__role=5, project__guest_view_all_features=True)
                | Q(project__project_projectmember__role=5, project__guest_view_all_features=False, created_by=request.user)
            )
        queryset = queryset.filter(membership_scope).distinct()
        allowed = set(queryset.values_list("id", flat=True))
        # Filtering happens before root selection. A matching child becomes a
        # root when its parent is excluded, so excluded labels never leak as
        # unfiltered context rows.
        scoped = queryset.select_related("state", "project").prefetch_related(
            Prefetch("issue_assignee", queryset=IssueAssignee.objects.filter(deleted_at__isnull=True).select_related("assignee"))
        )
        order_value = (view.display_filters or {}).get("order_by", "-created_at")
        order_value = sanitize_order_by(order_value, VIEW_ORDER_BY_ALLOWLIST, "-created_at")
        scoped, order_value = order_issue_queryset(scoped, order_value)
        # The authorized saved view bounds scope; do not silently truncate its
        # matching rows because that would make the hierarchy/count disagree.
        rows = list(scoped)
        children = {}
        for row in rows:
            children.setdefault(row.parent_id, []).append(row)

        def serialize(row, path=None):
            path = set() if path is None else path
            if row.id in path:
                return None
            next_path = path | {row.id}
            serialized_children = [serialize(child, next_path) for child in children.get(row.id, [])]
            return {
                "id": str(row.id),
                "project_id": str(row.project_id),
                "identifier": f"{row.project.identifier}-{row.sequence_id}",
                "name": row.name,
                "state": ({"id": str(row.state_id), "name": row.state.name, "group": row.state.group, "color": row.state.color} if row.state else None),
                "assignees": [{"id": str(a.assignee_id), "name": a.assignee.display_name, "avatar_url": a.assignee.avatar_url} for a in row.issue_assignee.all()],
                "priority": row.priority,
                "start_date": row.start_date,
                "target_date": row.target_date,
                "parent_id": str(row.parent_id) if row.parent_id else None,
                "child_count": len(serialized_children),
                "children": [child for child in serialized_children if child is not None],
                "context_only": False,
            }

        loaded_ids = {row.id for row in rows}
        roots = [row for row in rows if row.parent_id not in loaded_ids]
        # A malformed parent cycle has no natural root. Select its first row in
        # the saved stable order; the path guard above cuts the closing edge.
        if rows and not roots:
            roots = [rows[0]]
        rooted = []
        visited = set()
        for root in roots:
            if root.id not in visited:
                rooted.append(root)
                stack = [root]
                while stack:
                    current = stack.pop()
                    if current.id in visited:
                        continue
                    visited.add(current.id)
                    stack.extend(reversed(children.get(current.id, [])))
        # Keep disconnected cyclic components visible and deterministic.
        for row in rows:
            if row.id not in visited:
                rooted.append(row)
                stack = [row]
                while stack:
                    current = stack.pop()
                    if current.id in visited:
                        continue
                    visited.add(current.id)
                    stack.extend(reversed(children.get(current.id, [])))
        return Response({
            "view": {"id": str(view.id), "name": view.name, "project_id": str(view.project_id) if view.project_id else None, "display_filters": _safe_display_filters(view.display_filters)},
            "results": [serialize(row) for row in rooted],
            "count": len(allowed),
            "hierarchy_scope": "view_results",
        })


def _safe_display_filters(value):
    value = value if isinstance(value, dict) else {}
    return {key: value.get(key) for key in ("layout", "order_by", "group_by")}
