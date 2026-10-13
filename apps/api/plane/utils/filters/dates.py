"""Calendar-date filters with persistent, query-time relative values."""
from datetime import timedelta

from django import forms
from django.utils import timezone
from django_filters import filters


def resolve_date(value, today=None):
    """Resolve named calendar boundaries in the active user's timezone."""
    today = today or timezone.localdate()
    monday = today - timedelta(days=today.weekday())
    boundaries = {
        "today": today,
        "yesterday": today - timedelta(days=1),
        "tomorrow": today + timedelta(days=1),
        "this_monday": monday,
        "previous_monday": monday - timedelta(days=7),
        "previous_sunday": monday - timedelta(days=1),
        "next_monday": monday + timedelta(days=7),
        "this_sunday": monday + timedelta(days=6),
        "month_start": today.replace(day=1),
        "previous_month_start": (today.replace(day=1) - timedelta(days=1)).replace(day=1),
        "one_week_ago": today - timedelta(days=7),
    }
    return boundaries.get(value, value) if isinstance(value, str) else value


class RelativeDateField(forms.DateField):
    def to_python(self, value):
        return super().to_python(resolve_date(value))


class RelativeDateFilter(filters.DateFilter):
    field_class = RelativeDateField


class RelativeDateRangeFilter(filters.BaseCSVFilter, RelativeDateFilter):
    pass
