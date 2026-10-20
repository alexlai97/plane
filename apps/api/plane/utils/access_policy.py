"""Central access-profile policy for workspace-scoped API endpoints.

Numeric Plane roles continue to govern existing workspace behavior. Access
profiles add narrow, declarative policies for exceptional readers.
"""

from dataclasses import dataclass, field

from django.db.models import Q
from rest_framework.exceptions import PermissionDenied

from plane.db.models import Workspace, WorkspaceMember, Issue, IssueLabel, Label


SUMMARY_OBSERVER = "summary_observer"
STANDARD = "standard"

# Capability names are a stable contract shared by backend routes and clients.
SUMMARY_OBSERVER_CAPABILITIES = frozenset(
    {
        "workspace.summary.read",
        "project.summary.read",
        "view.summary.read",
        "work_item.summary.read",
        "artifact.published.read",
        "artifact.material.read",
        "presentation.published.read",
        "presentation.material.read",
        "member.self.read",
    }
)
# This is a client-facing baseline for normal-profile flows, not an effective
# authorization grant. Existing numeric-role and endpoint permissions remain
# authoritative for every standard member.
STANDARD_CAPABILITIES = SUMMARY_OBSERVER_CAPABILITIES | frozenset({"work_item.detail.read"})

PROFILE_CAPABILITIES = {
    STANDARD: STANDARD_CAPABILITIES,
    SUMMARY_OBSERVER: SUMMARY_OBSERVER_CAPABILITIES,
}


@dataclass(frozen=True)
class WorkspaceAccessPolicy:
    profile: str
    capabilities: frozenset[str]
    allowed_project_ids: frozenset[str] | None
    allowed_view_ids: frozenset[str] | None
    workspace_id: str

    hidden_issue_ids: frozenset[str] = field(default_factory=frozenset)

    def require_issue(self, issue_id):
        if self.is_restricted and str(issue_id) in self.hidden_issue_ids:
            raise PermissionDenied("This work item is outside the granted workspace scope.")

    def require_document(self, document):
        if not self.is_restricted:
            return
        for section in document.get("sections", []):
            for slide in section.get("slides", []):
                for issue_id in slide.get("issue_ids", []):
                    self.require_issue(issue_id)

    def filter_issues(self, queryset):
        return queryset.exclude(id__in=self.hidden_issue_ids) if self.is_restricted else queryset

    @property
    def is_restricted(self):
        return self.profile != STANDARD

    def allows(self, capability):
        return capability in self.capabilities

    def require(self, capability, project_id=None, view_id=None):
        if not self.allows(capability):
            raise PermissionDenied("This workspace access profile cannot read this resource.")
        if project_id is not None and self.allowed_project_ids is not None:
            if str(project_id) not in self.allowed_project_ids:
                raise PermissionDenied("This project is outside the granted workspace scope.")
        if view_id is not None and self.allowed_view_ids is not None:
            if str(view_id) not in self.allowed_view_ids:
                raise PermissionDenied("This saved view is outside the granted workspace scope.")
        return True

    def as_dict(self):
        return {
            "profile": self.profile,
            "capabilities": sorted(self.capabilities),
            "project_ids": None if self.allowed_project_ids is None else sorted(self.allowed_project_ids),
            "view_ids": None if self.allowed_view_ids is None else sorted(self.allowed_view_ids),
        }


def observer_hidden_issues(workspace):
    """A configured label hides a complete subtree, independently of saved filters.

    Include deleted ancestors so surviving descendants cannot become public
    roots. Removing an active label assignment intentionally restores access.
    """
    configured = workspace.observer_hidden_label_ids
    if configured == []:
        return frozenset()
    from uuid import UUID
    try:
        if not isinstance(configured, list):
            raise ValueError()
        label_ids = {str(UUID(value)) for value in configured}
    except (ValueError, TypeError, AttributeError):
        raise PermissionDenied("Invalid observer visibility configuration.")
    existing = {str(value) for value in Label.objects.filter(
        workspace=workspace, id__in=label_ids
    ).values_list("id", flat=True)}
    if existing != label_ids:
        raise PermissionDenied("Invalid observer visibility configuration.")
    hidden = {str(value) for value in IssueLabel.objects.filter(
        workspace=workspace, label_id__in=label_ids
    ).values_list("issue_id", flat=True)}
    children = {}
    for issue_id, parent_id in Issue.all_objects.filter(workspace=workspace).values_list("id", "parent_id"):
        children.setdefault(str(parent_id), []).append(str(issue_id))
    pending = list(hidden)
    while pending:
        for child in children.get(pending.pop(), []):
            if child not in hidden:
                hidden.add(child)
                pending.append(child)
    return frozenset(hidden)


def get_workspace_access_policy(request, workspace_slug):
    """Return a per-request cached policy after verifying active membership."""
    cache = getattr(request, "_workspace_access_policies", {})
    if str(workspace_slug) in cache:
        return cache[str(workspace_slug)]

    try:
        workspace = Workspace.objects.get(slug=workspace_slug)
        membership = WorkspaceMember.objects.get(
            workspace=workspace,
            member=request.user,
            is_active=True,
            deleted_at__isnull=True,
        )
    except (Workspace.DoesNotExist, WorkspaceMember.DoesNotExist):
        raise PermissionDenied("Active workspace membership is required.")

    profile = membership.access_profile
    capabilities = PROFILE_CAPABILITIES.get(profile, frozenset())
    if profile == STANDARD:
        projects = None
        views = None
    elif profile == SUMMARY_OBSERVER:
        projects = frozenset(
            str(value)
            for value in membership.project_grants.values_list("project_id", flat=True)
            .filter(
                project__workspace=workspace,
                project__deleted_at__isnull=True,
                project__project_projectmember__member=membership.member,
                project__project_projectmember__is_active=True,
                project__project_projectmember__deleted_at__isnull=True,
            )
            .distinct()
        )
        views = frozenset(
            str(value)
            for value in membership.view_grants.values_list("view_id", flat=True)
            .filter(view__workspace=workspace, view__deleted_at__isnull=True, view__access=1)
            .filter(
                Q(view__project__isnull=True)
                | Q(
                    view__project__deleted_at__isnull=True,
                    view__project__project_projectmember__member=membership.member,
                    view__project__project_projectmember__is_active=True,
                    view__project__project_projectmember__deleted_at__isnull=True,
                )
            )
            .distinct()
        )
    else:
        projects = frozenset()
        views = frozenset()

    hidden = observer_hidden_issues(workspace) if profile != STANDARD else frozenset()
    policy = WorkspaceAccessPolicy(profile, capabilities, projects, views, str(workspace.id), hidden)
    cache[str(workspace_slug)] = policy
    request._workspace_access_policies = cache
    request.workspace_access_policy = policy
    request.workspace_access_membership = membership
    request.workspace_access_workspace = workspace
    return policy


def clear_workspace_member_access_grants(membership):
    """Revoke persisted narrow scopes when a workspace membership is removed."""
    membership.project_grants.all().delete()
    membership.view_grants.all().delete()


def enforce_workspace_access_policy(view, request, kwargs):
    """Fail closed for restricted profiles unless the route declares access."""
    if getattr(view, "access_policy_exempt", False):
        return
    slug = kwargs.get("slug")
    workspace_id = kwargs.get("workspace_id")
    if not slug and workspace_id:
        slug = Workspace.objects.filter(id=workspace_id).values_list("slug", flat=True).first()
    if not slug:
        if getattr(view, "access_policy_global_exempt", False):
            return
        exempt_methods = getattr(view, "access_policy_global_exempt_methods", frozenset())
        if request.method.upper() in exempt_methods:
            return
        if not request.user.is_authenticated:
            return
        restricted_membership_exists = WorkspaceMember.objects.filter(
            member=request.user,
            is_active=True,
            deleted_at__isnull=True,
        ).exclude(access_profile=STANDARD).exists()
        if restricted_membership_exists:
            raise PermissionDenied("This unscoped endpoint is unavailable to restricted workspace profiles.")
        return
    # Preserve existing authorization behavior for non-members. This layer is
    # additive and only gates members who have selected a restricted profile.
    membership = WorkspaceMember.objects.filter(
        workspace__slug=slug,
        member=request.user,
        is_active=True,
        deleted_at__isnull=True,
    ).only("access_profile").first()
    if membership is None or membership.access_profile == STANDARD:
        return
    policy = get_workspace_access_policy(request, slug)

    declared = getattr(view, "access_policy_capabilities", None)
    if declared is None:
        capability = getattr(view, "access_policy_capability", None)
        declared = {"GET": capability, "HEAD": capability, "OPTIONS": capability} if capability else {}
    method = request.method.upper()
    capability = declared.get(method)
    if not capability:
        raise PermissionDenied("This workspace endpoint is not available to the current access profile.")

    project_id = kwargs.get("project_id") or kwargs.get("project")
    view_id = kwargs.get("view_id") or kwargs.get("view_pk")
    policy.require(capability, project_id=project_id, view_id=view_id)
