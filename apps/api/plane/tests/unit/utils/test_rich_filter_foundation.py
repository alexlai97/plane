"""Behavioral contracts for editable saved filters, including relation negation."""
from datetime import date
from types import SimpleNamespace

from django.test import TestCase, SimpleTestCase
from django.utils import timezone
from rest_framework.exceptions import ValidationError

from plane.db.models import User, Workspace, Project, Issue, Label, IssueLabel
from plane.utils.filters import ComplexFilterBackend, IssueFilterSet
from plane.utils.filters.dates import resolve_date


class RelativeDateTests(SimpleTestCase):
    def test_previous_monday_is_previous_calendar_week_not_rolling_seven_days(self):
        self.assertEqual(resolve_date("previous_monday", date(2026, 10, 13)), date(2026, 10, 5))
        self.assertEqual(resolve_date("previous_monday", date(2026, 10, 19)), date(2026, 10, 12))
        self.assertEqual(resolve_date("previous_sunday", date(2026, 1, 1)), date(2025, 12, 28))
        self.assertEqual(resolve_date("today", date(2026, 10, 13)), date(2026, 10, 13))

    def test_normalization_preserves_conditions_and_replaces_only_open_bounds(self):
        from plane.db.management.commands.normalize_view_filters import normalize_expression
        original = {"and": [{"start_date__range": "0001-01-01,2026-10-13"},
                             {"target_date__range": "2026-10-05,9999-12-31"},
                             {"not": {"label_id__in": "keep-label-id"}}]}
        expected = {"and": [{"start_date__lte": "today"},
                             {"target_date__gte": "previous_monday"},
                             {"not": {"label_id__in": "keep-label-id"}}]}
        self.assertEqual(normalize_expression(original, True), expected)
        self.assertEqual(normalize_expression(expected, True), expected)
        self.assertEqual(original["and"][0]["start_date__range"], "0001-01-01,2026-10-13")


class RichFilterFoundationTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        cls.user = User.objects.create(email="filter-qa@example.invalid", username="filter-qa")
        cls.workspace = Workspace.objects.create(name="Filter QA", slug="filter-qa", owner=cls.user)
        cls.project = Project.objects.create(name="Filter QA", identifier="FQA", workspace=cls.workspace)
        cls.label = Label.objects.create(name="长期任务", project=cls.project, workspace=cls.workspace)
        cls.other_label = Label.objects.create(name="其他", project=cls.project, workspace=cls.workspace)
        cls.plain = cls.issue("无标签", start_date=date(2026, 10, 5), target_date=date(2026, 10, 13))
        cls.long = cls.issue("长期且有其他标签", start_date=date(2026, 10, 1), target_date=date(2026, 12, 31))
        cls.deleted = cls.issue("只有已删除标签")
        cls.missing = cls.issue("缺少日期")
        for label in [cls.label, cls.other_label]:
            IssueLabel.objects.create(issue=cls.long, label=label, project=cls.project, workspace=cls.workspace)
        row = IssueLabel.objects.create(issue=cls.deleted, label=cls.label, project=cls.project, workspace=cls.workspace)
        IssueLabel.objects.filter(pk=row.pk).update(deleted_at=timezone.now())

    @classmethod
    def issue(cls, name, **kwargs):
        return Issue.objects.create(name=name, project=cls.project, workspace=cls.workspace, **kwargs)

    def matching(self, expression):
        queryset = Issue.objects.filter(project=self.project)
        result = ComplexFilterBackend().filter_queryset(
            None, queryset, SimpleNamespace(filterset_class=IssueFilterSet), filter_data=expression
        )
        return set(result.values_list("id", flat=True))

    def test_exclude_label_retains_untagged_and_soft_deleted_and_removes_multi_label(self):
        self.assertEqual(self.matching({"not": {"label_id__in": str(self.label.id)}}),
                         {self.plain.id, self.deleted.id, self.missing.id})

    def test_empty_label_ignores_deleted_relations(self):
        self.assertEqual(self.matching({"label_id__isnull": True}),
                         {self.plain.id, self.deleted.id, self.missing.id})
        self.assertEqual(self.matching({"label_id__isnull": False}), {self.long.id})

    def test_array_values_keep_all_members_instead_of_only_last(self):
        from uuid import uuid4
        self.assertEqual(self.matching({"label_id__in": [str(self.label.id), str(uuid4())]}), {self.long.id})

    def test_nested_any_all_and_exclusion(self):
        expression = {"and": [{"or": [{"label_id__in": str(self.label.id)}, {"start_date__isnull": False}]},
                              {"not": {"label_id__in": str(self.label.id)}}]}
        self.assertEqual(self.matching(expression), {self.plain.id})

    def test_inclusive_date_intersection_excludes_missing_dates(self):
        self.assertEqual(self.matching({"and": [{"start_date__lte": "2026-10-13"},
                                                {"target_date__gte": "2026-10-05"}]}),
                         {self.plain.id, self.long.id})

    def test_relative_boundary_is_resolved_when_querying_not_when_saved(self):
        expression = {"and": [{"start_date__lte": "today"}, {"target_date__gte": "previous_monday"}]}
        from unittest.mock import patch
        with patch("plane.utils.filters.dates.timezone.localdate", return_value=date(2026, 10, 13)):
            self.assertEqual(self.matching(expression), {self.plain.id, self.long.id})
        with patch("plane.utils.filters.dates.timezone.localdate", return_value=date(2026, 10, 26)):
            self.assertEqual(self.matching(expression), {self.long.id})
        self.assertEqual(expression["and"][0]["start_date__lte"], "today")

    def test_unknown_dates_fail_instead_of_silently_ignoring_filter(self):
        with self.assertRaises(ValidationError):
            self.matching({"start_date__lte": "last_whenever"})

    def test_timestamp_date_comparison_covers_entire_boundary_day(self):
        Issue.objects.filter(pk=self.plain.pk).update(created_at=timezone.make_aware(
            __import__("datetime").datetime(2026, 10, 13, 23, 59)))
        self.assertIn(self.plain.id, self.matching({"created_at__lte": "2026-10-13"}))

    def test_saved_view_validates_rules_before_persisting(self):
        from plane.app.serializers.view import IssueViewSerializer
        good = IssueViewSerializer(data={"name": "共享视图", "rich_filters": {
            "and": [{"start_date__lte": "today"}, {"not": {"label_id__in": str(self.label.id)}}]}})
        self.assertTrue(good.is_valid(), good.errors)
        bad = IssueViewSerializer(data={"name": "无效视图", "rich_filters": {"invented_filter": "bad"}})
        self.assertFalse(bad.is_valid())
