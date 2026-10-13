"""One-time, reversible normalization of saved view configuration."""
import copy
import json
import os
from pathlib import Path
from types import SimpleNamespace

from django.core.management.base import BaseCommand, CommandError
from django.db import transaction

from plane.db.models import IssueView, Issue, Label
from plane.utils.filters import ComplexFilterBackend, IssueFilterSet


def normalize_expression(expression, relative=False):
    if not isinstance(expression, dict):
        return expression
    output = {}
    for key, value in expression.items():
        if key in ("and", "or"):
            output[key] = [normalize_expression(child, relative) for child in value]
        elif key == "not":
            output[key] = normalize_expression(value, relative)
        elif key.endswith("__range") and isinstance(value, str) and "," in value:
            lower, upper = value.split(",", 1)
            field = key.removesuffix("__range")
            if lower == "0001-01-01":
                output[f"{field}__lte"] = "today" if relative and field == "start_date" else upper
            elif upper == "9999-12-31":
                output[f"{field}__gte"] = "previous_monday" if relative and field == "target_date" else lower
            else:
                output[key] = value
        else:
            output[key] = value
    return output


class Command(BaseCommand):
    help = "Normalize saved filters; dry run by default. Never modifies task data."

    def add_arguments(self, parser):
        parser.add_argument("--workspace", required=True)
        parser.add_argument("--relative-view", action="append", default=[])
        parser.add_argument("--exclude-view")
        parser.add_argument("--exclude-label")
        parser.add_argument("--backup")
        parser.add_argument("--apply", action="store_true")

    def handle(self, *args, **options):
        if options["apply"] and not options["backup"]:
            raise CommandError("--apply requires an exclusive backup file")
        if bool(options["exclude_view"]) != bool(options["exclude_label"]):
            raise CommandError("--exclude-view and --exclude-label must be supplied together")
        backend = ComplexFilterBackend()
        validation_view = SimpleNamespace(filterset_class=IssueFilterSet)
        with transaction.atomic():
            views = list(IssueView.objects.select_for_update().filter(
                workspace__slug=options["workspace"], deleted_at__isnull=True
            ))
            by_id = {str(view.id): view for view in views}
            requested = set(options["relative_view"])
            if options["exclude_view"]:
                requested.add(options["exclude_view"])
            if not requested.issubset(by_id):
                raise CommandError("Requested views are outside the workspace or no longer active")
            before, changes = [], []
            for view in views:
                snapshot = {"id": str(view.id), "name": view.name, "description": view.description,
                            "rich_filters": view.rich_filters, "filters": view.filters,
                            "query": view.query, "display_filters": view.display_filters}
                before.append(copy.deepcopy(snapshot))
                rich = normalize_expression(view.rich_filters, str(view.id) in options["relative_view"])
                if str(view.id) == options["exclude_view"]:
                    label = Label.objects.get(pk=options["exclude_label"], project_id=view.project_id,
                                              deleted_at__isnull=True)
                    condition = {"not": {"label_id__in": str(label.id)}}
                    if rich != condition and condition not in rich.get("and", []):
                        rich = {"and": [rich, condition]} if rich else condition
                backend.filter_queryset(None, Issue.objects.none(), validation_view, filter_data=rich)
                display = copy.deepcopy(view.display_filters)
                # These layouts previously ignored inherited group settings.
                # Keep the existing presentation until users explicitly group it.
                if display.get("view_config_version", 1) < 2 and display.get("layout") in ("spreadsheet", "gantt_chart"):
                    display["group_by"] = None
                    display["sub_group_by"] = None
                if display.get("order_by") and not display.get("order_by_fields"):
                    display["order_by_fields"] = [display["order_by"]]
                display["view_config_version"] = 2
                legacy = {} if rich else view.filters
                description = view.description
                if str(view.id) in options["relative_view"]:
                    description = "日期范围：上周一至今天，随查询时间自动推进。任务开始日期不晚于今天、截止日期不早于上周一；缺日期不匹配。保留排除标签及任务层级规则，可在筛选栏编辑。"
                if (rich, display, legacy, description) != (view.rich_filters, view.display_filters, view.filters, view.description):
                    changes.append({"id": str(view.id), "name": view.name, "rich_filters": rich,
                                    "display_filters": display, "filters": legacy, "description": description})
            if options["apply"]:
                destination = Path(options["backup"])
                descriptor = os.open(destination, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
                with os.fdopen(descriptor, "w") as stream:
                    json.dump(before, stream, ensure_ascii=False, indent=2, default=str)
                for change in changes:
                    view = by_id[change["id"]]
                    for field in ("rich_filters", "display_filters", "filters", "description"):
                        setattr(view, field, change[field])
                    view.save(update_fields=["rich_filters", "display_filters", "filters", "description", "query", "updated_at"])
            self.stdout.write(json.dumps({"applied": options["apply"], "changes": changes}, ensure_ascii=False))
