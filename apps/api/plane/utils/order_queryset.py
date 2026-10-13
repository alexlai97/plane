# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

from django.db.models import Case, Count, F, IntegerField, Min, OuterRef, Subquery, Value, When
from django.db.models.functions import Coalesce

from plane.db.models import FileAsset, Issue, IssueLink

# Custom ordering for priority and state
PRIORITY_ORDER = ["urgent", "high", "medium", "low", "none"]
STATE_ORDER = ["backlog", "unstarted", "started", "completed", "cancelled"]

# ---------------------------------------------------------------------------
# order_by allowlists — one per model/endpoint family
# All contain bare field names (no leading '-'); the sanitizer strips the
# prefix before looking up, so descending variants are implicitly covered.
# Prevents ORM order_by injection via user-supplied query params
# (GHSA-2r95-c453-vxmr / GHSA-w45q-6m65-9498).
# ---------------------------------------------------------------------------

ISSUE_ORDER_BY_ALLOWLIST = frozenset({
    "created_at",
    "updated_at",
    "sequence_id",
    "sort_order",
    "target_date",
    "start_date",
    "completed_at",
    "archived_at",
    "priority",
    "state__name",
    "state__group",
    "assignees__first_name",
    "labels__name",
    "issue_module__module__name",
    "issue_cycle__cycle__name",
    "estimate_point__key",
    "link_count",
    "attachment_count",
    "sub_issues_count",
})

# IntakeIssue queryset — fields are prefixed with `issue__` for the join.
INTAKE_ISSUE_ORDER_BY_ALLOWLIST = frozenset({
    "issue__created_at",
    "issue__updated_at",
    "issue__sequence_id",
    "issue__sort_order",
    "issue__target_date",
    "issue__start_date",
    "issue__priority",
    "issue__state__name",
    "created_at",
    "updated_at",
    "status",
})

# IssueActivity queryset (user activity, workspace member activity).
ACTIVITY_ORDER_BY_ALLOWLIST = frozenset({
    "created_at",
    "updated_at",
})

# Project list queryset.
PROJECT_ORDER_BY_ALLOWLIST = frozenset({
    "created_at",
    "updated_at",
    "name",
    "network",
    "sort_order",
})

# Saved view (IssueView) list queryset.
VIEW_ORDER_BY_ALLOWLIST = frozenset({
    "created_at",
    "updated_at",
    "name",
})

# Notification queryset.
NOTIFICATION_ORDER_BY_ALLOWLIST = frozenset({
    "created_at",
    "updated_at",
})

# ---------------------------------------------------------------------------
# group_by / sub_group_by allowlist for Issue querysets — used by
# GroupedOffsetPaginator / SubGroupedOffsetPaginator (plane/utils/paginator.py),
# which pass the field name straight into F(), .values(), .order_by(), and
# Window partition_by. Prevents unauthenticated ORM field-name injection via
# user-supplied query params (GHSA-wwgj-929g-42cm).
# ---------------------------------------------------------------------------
ISSUE_GROUP_BY_ALLOWLIST = frozenset({
    "state_id",
    "state__group",
    "priority",
    "labels__id",
    "assignees__id",
    "issue_module__module_id",
    "cycle_id",
    "project_id",
    "created_by",
    "target_date",
    "start_date",
})

# Cycle list queryset.
CYCLE_ORDER_BY_ALLOWLIST = frozenset({
    "created_at",
    "updated_at",
    "name",
    "start_date",
    "end_date",
    "sort_order",
})

# Module list queryset.
MODULE_ORDER_BY_ALLOWLIST = frozenset({
    "created_at",
    "updated_at",
    "name",
    "start_date",
    "target_date",
    "status",
    "sort_order",
})

def sanitize_order_by(value, allowed_fields, default="-created_at"):
    """Return a safe ordering string derived from *value*.

    Strips at most one leading '-' (descending indicator), checks the bare
    field name against *allowed_fields*, and reconstructs the value.  Inputs
    with multiple leading dashes (e.g. ``--created_at``) are rejected and
    *default* is returned instead, preventing both allowlist bypass and
    malformed tokens from reaching ``.order_by()``.

    Call this before passing any user-supplied ordering string to .order_by() or
    a paginator to prevent ORM order_by injection.
    """
    if not value:
        return default
    is_desc = value.startswith("-")
    bare = value[1:] if is_desc else value
    # Reject malformed prefixes like "--created_at".
    if bare.startswith("-"):
        return default
    if bare not in allowed_fields:
        return default
    return f"-{bare}" if is_desc else bare


def _order_issue_queryset_multi(issue_queryset, order_by_param):
    """Apply an ordered list of issue sort criteria.

    The request value is a comma-separated list. Resolve every public field
    through the same allowlist used by the single-sort path, then translate
    fields with domain-specific ordering into private annotations. Returning
    the resolved field names lets all paginator variants apply the exact same
    ordering, including grouped and nested-group queries.
    """
    if isinstance(order_by_param, (list, tuple)):
        raw_fields = order_by_param
    else:
        raw_fields = str(order_by_param or "-created_at").split(",")
    fields = []
    for raw_field in raw_fields:
        field = sanitize_order_by(str(raw_field).strip(), ISSUE_ORDER_BY_ALLOWLIST, default="")
        if field and field not in fields:
            fields.append(field)

    if not fields:
        fields = ["-created_at"]

    resolved = []
    annotations = {}
    for index, field in enumerate(fields):
        descending = field.startswith("-")
        bare_field = field[1:] if descending else field
        alias = f"_sort_{index}"

        if bare_field == "priority":
            annotations[alias] = Case(
                *[
                    When(priority=value, then=Value(len(PRIORITY_ORDER) - index))
                    for index, value in enumerate(PRIORITY_ORDER)
                ],
                default=Value(None, output_field=IntegerField()),
                output_field=IntegerField(),
            )
            bare_field = alias
        elif bare_field == "state__group":
            annotations[alias] = Case(
                *[When(state__group=value, then=Value(index)) for index, value in enumerate(STATE_ORDER)],
                default=Value(len(STATE_ORDER)),
                output_field=IntegerField(),
            )
            bare_field = alias
        elif bare_field in {
            "labels__name",
            "assignees__first_name",
            "issue_module__module__name",
            "issue_cycle__cycle__name",
        }:
            annotations[alias] = Min(bare_field)
            bare_field = alias
        elif bare_field == "link_count":
            annotations[alias] = Coalesce(
                Subquery(
                    IssueLink.objects.filter(issue=OuterRef("id"))
                    .values("issue")
                    .annotate(count=Count("id"))
                    .values("count")
                ),
                Value(0),
                output_field=IntegerField(),
            )
            bare_field = alias
        elif bare_field == "attachment_count":
            annotations[alias] = Coalesce(
                Subquery(
                    FileAsset.objects.filter(
                        issue_id=OuterRef("id"),
                        entity_type=FileAsset.EntityTypeContext.ISSUE_ATTACHMENT,
                    )
                    .values("issue_id")
                    .annotate(count=Count("id"))
                    .values("count")
                ),
                Value(0),
                output_field=IntegerField(),
            )
            bare_field = alias
        elif bare_field == "sub_issues_count":
            annotations[alias] = Coalesce(
                Subquery(
                    Issue.issue_objects.filter(parent=OuterRef("id"))
                    .values("parent")
                    .annotate(count=Count("id"))
                    .values("count")
                ),
                Value(0),
                output_field=IntegerField(),
            )
            bare_field = alias

        resolved.append(f"-{bare_field}" if descending else bare_field)

    if annotations:
        issue_queryset = issue_queryset.annotate(**annotations)

    # Deterministic pagination needs a unique final key. Keep caller criteria
    # in their supplied priority order and only append the primary key as a tie
    # breaker; do not silently add another business sort criterion.
    if not any(field.lstrip("-") == "id" for field in resolved):
        resolved.append("id")

    ordering_expressions = []
    for value in resolved:
        descending = value.startswith("-")
        field = value[1:] if descending else value
        expression = F(field)
        ordering_expressions.append(
            expression.desc(nulls_last=True) if descending else expression.asc(nulls_last=True)
        )
    issue_queryset = issue_queryset.order_by(*ordering_expressions)
    return issue_queryset, resolved


def order_issue_queryset(issue_queryset, order_by_param="-created_at"):
    """Apply the same safe ordering contract for legacy single-sort and lists."""
    return _order_issue_queryset_multi(issue_queryset, order_by_param)
