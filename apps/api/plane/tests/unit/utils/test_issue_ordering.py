"""Ordering behavior shared by issue lists and grouped issue layouts."""

from django.db.models import Q
from django.test import TestCase

from plane.db.models import (
    Estimate,
    EstimatePoint,
    Issue,
    IssueLabel,
    IssueLink,
    Label,
    Project,
    State,
    User,
    Workspace,
)
from plane.utils.order_queryset import order_issue_queryset
from plane.utils.paginator import Cursor, GroupedOffsetPaginator, OffsetPaginator, SubGroupedOffsetPaginator


class IssueOrderingTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        cls.user = User.objects.create(username="ordering-user", email="ordering@example.invalid")
        cls.workspace = Workspace.objects.create(name="Ordering", slug="ordering", owner=cls.user)
        cls.project = Project.objects.create(name="Ordering", identifier="ORD", workspace=cls.workspace)
        cls.backlog = State.objects.create(
            name="Backlog", color="#777777", group="backlog", project=cls.project, workspace=cls.workspace
        )
        cls.completed = State.objects.create(
            name="Done", color="#00aa00", group="completed", project=cls.project, workspace=cls.workspace
        )

    def create_issue(self, name, priority="none", sequence_id=1, state=None, parent=None):
        return Issue.objects.create(
            name=name,
            priority=priority,
            sequence_id=sequence_id,
            project=self.project,
            workspace=self.workspace,
            created_by=self.user,
            state=state or self.backlog,
            parent=parent,
        )

    def test_priority_single_and_multi_sort_have_same_direction(self):
        none = self.create_issue("none", priority="none", sequence_id=1)
        low = self.create_issue("low", priority="low", sequence_id=2)
        urgent = self.create_issue("urgent", priority="urgent", sequence_id=3)
        queryset = Issue.objects.filter(project=self.project)

        single_queryset, single_order = order_issue_queryset(queryset, "-priority")
        multi_queryset, _ = order_issue_queryset(queryset, "-priority")
        ascending_queryset, _ = order_issue_queryset(queryset, "priority")

        self.assertEqual(
            list(single_queryset.values_list("id", flat=True)),
            list(multi_queryset.values_list("id", flat=True)),
        )
        self.assertEqual(list(single_queryset.values_list("id", flat=True)), [urgent.id, low.id, none.id])
        self.assertEqual(list(ascending_queryset.values_list("id", flat=True)), [none.id, low.id, urgent.id])
        self.assertEqual(single_order, ["-_sort_0", "id"])

    def test_nullable_and_spreadsheet_annotation_sort_fields_are_supported(self):
        parent = self.create_issue("parent")
        child = self.create_issue("child", parent=parent)
        IssueLink.objects.create(
            title="Reference", url="https://example.invalid", issue=parent,
            project=self.project, workspace=self.workspace,
        )
        estimate = Estimate.objects.create(name="Points", project=self.project, workspace=self.workspace)
        point = EstimatePoint.objects.create(
            estimate=estimate, key=5, value="5", project=self.project, workspace=self.workspace
        )
        estimated = self.create_issue("estimated")
        estimated.estimate_point = point
        estimated.save(update_fields=["estimate_point"])

        for field in (
            "estimate_point__key",
            "link_count",
            "attachment_count",
            "sub_issues_count",
        ):
            with self.subTest(field=field):
                queryset, ordering = order_issue_queryset(Issue.objects.filter(project=self.project), field)
                values = list(queryset.values_list("id", flat=True))
                self.assertEqual(len(values), len(set(values)))
                self.assertTrue(ordering[-1] == "id")

        estimate_queryset, _ = order_issue_queryset(
            Issue.objects.filter(project=self.project), "estimate_point__key"
        )
        estimate_order = list(estimate_queryset.values_list("id", flat=True))
        self.assertEqual(estimate_order[0], estimated.id)
        self.assertIn(child.id, estimate_order[1:])
        link_queryset, _ = order_issue_queryset(Issue.objects.filter(project=self.project), "-link_count")
        self.assertEqual(list(link_queryset.values_list("id", flat=True))[0], parent.id)
        sub_issue_queryset, _ = order_issue_queryset(Issue.objects.filter(project=self.project), "-sub_issues_count")
        self.assertEqual(list(sub_issue_queryset.values_list("id", flat=True))[0], parent.id)

    def test_multivalue_sort_aggregates_keep_one_row_per_issue(self):
        issue = self.create_issue("multiple labels")
        for name in ("Alpha", "Zulu"):
            label = Label.objects.create(name=name, project=self.project, workspace=self.workspace)
            IssueLabel.objects.create(issue=issue, label=label, project=self.project, workspace=self.workspace)

        queryset, ordering = order_issue_queryset(
            Issue.objects.filter(project=self.project), "labels__name,-priority"
        )
        values = list(queryset.values_list("id", flat=True))

        self.assertEqual(values.count(issue.id), 1)
        self.assertEqual(ordering, ["_sort_0", "-_sort_1", "id"])

    def test_state_group_sort_is_semantic_and_direction_reverses_once(self):
        completed = self.create_issue("done", state=self.completed)
        backlog = self.create_issue("backlog", state=self.backlog)
        ascending, _ = order_issue_queryset(Issue.objects.filter(project=self.project), "state__group")
        descending, _ = order_issue_queryset(Issue.objects.filter(project=self.project), "-state__group")

        self.assertEqual(list(ascending.values_list("id", flat=True)), [backlog.id, completed.id])
        self.assertEqual(list(descending.values_list("id", flat=True)), [completed.id, backlog.id])

    def test_flat_multi_sort_pages_have_stable_counts_and_no_duplicates(self):
        urgent_a = self.create_issue("urgent a", priority="urgent", sequence_id=2)
        urgent_b = self.create_issue("urgent b", priority="urgent", sequence_id=1)
        high = self.create_issue("high", priority="high", sequence_id=3)
        Issue.objects.filter(pk=urgent_a.pk).update(sequence_id=2)
        Issue.objects.filter(pk=urgent_b.pk).update(sequence_id=1)
        Issue.objects.filter(pk=high.pk).update(sequence_id=3)
        queryset, ordering = order_issue_queryset(Issue.objects.filter(project=self.project), "-priority,sequence_id")
        paginator = OffsetPaginator(queryset=queryset, order_by=ordering)

        first = paginator.get_result(limit=2, cursor=Cursor(2, 0))
        second = paginator.get_result(limit=2, cursor=Cursor(2, 1))

        self.assertEqual(first.hits, 3)
        self.assertEqual(list(first.results.values_list("id", flat=True)), [urgent_b.id, urgent_a.id])
        self.assertEqual(list(second.results.values_list("id", flat=True)), [high.id])
        self.assertTrue(first.next.has_results)
        self.assertFalse(second.next.has_results)

    def test_grouped_multi_sort_uses_same_order_and_page_counts(self):
        urgent_a = self.create_issue("urgent a", priority="urgent", sequence_id=2)
        urgent_b = self.create_issue("urgent b", priority="urgent", sequence_id=1)
        high = self.create_issue("high", priority="high", sequence_id=3)
        Issue.objects.filter(pk=urgent_a.pk).update(sequence_id=2)
        Issue.objects.filter(pk=urgent_b.pk).update(sequence_id=1)
        Issue.objects.filter(pk=high.pk).update(sequence_id=3)
        queryset, ordering = order_issue_queryset(Issue.objects.filter(project=self.project), "-priority,sequence_id")
        paginator = GroupedOffsetPaginator(
            queryset=queryset,
            order_by=ordering,
            group_by_field_name="state_id",
            group_by_fields=[self.backlog.id],
            count_filter=Q(),
        )

        first = paginator.get_result(limit=2, cursor=Cursor(2, 0))
        second = paginator.get_result(limit=2, cursor=Cursor(2, 1))

        self.assertEqual(first.hits, 3)
        self.assertEqual(list(first.results.values_list("id", flat=True)), [urgent_b.id, urgent_a.id])
        self.assertEqual(list(second.results.values_list("id", flat=True)), [high.id])
        self.assertEqual(first.max_hits, 2)
        self.assertTrue(first.next.has_results)
        self.assertFalse(second.next.has_results)

    def test_subgrouped_multi_sort_keeps_counts_and_order_per_subgroup(self):
        urgent_a = self.create_issue("urgent a", priority="urgent", sequence_id=2)
        urgent_b = self.create_issue("urgent b", priority="urgent", sequence_id=1)
        high = self.create_issue("high", priority="high", sequence_id=3)
        Issue.objects.filter(pk=urgent_a.pk).update(sequence_id=2)
        Issue.objects.filter(pk=urgent_b.pk).update(sequence_id=1)
        Issue.objects.filter(pk=high.pk).update(sequence_id=3)
        queryset, ordering = order_issue_queryset(Issue.objects.filter(project=self.project), "-priority,sequence_id")
        paginator = SubGroupedOffsetPaginator(
            queryset=queryset,
            order_by=ordering,
            group_by_field_name="state_id",
            sub_group_by_field_name="priority",
            group_by_fields=[self.backlog.id],
            sub_group_by_fields=["urgent", "high"],
            count_filter=Q(),
        )

        first = paginator.get_result(limit=1, cursor=Cursor(1, 0))
        second = paginator.get_result(limit=1, cursor=Cursor(1, 1))
        third = paginator.get_result(limit=1, cursor=Cursor(1, 2))

        self.assertEqual(first.hits, 3)
        self.assertEqual(list(first.results.values_list("id", flat=True)), [urgent_b.id, high.id])
        self.assertEqual(list(second.results.values_list("id", flat=True)), [urgent_a.id])
        self.assertEqual(first.max_hits, 2)
        self.assertTrue(first.next.has_results)
        self.assertFalse(second.next.has_results)
        self.assertFalse(third.next.has_results)
