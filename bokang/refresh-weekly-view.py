"""Scoped Plane maintenance: reuse one view for last Monday through today."""
import os
import json
from datetime import date, datetime, timedelta
from zoneinfo import ZoneInfo

PROJECT = '0191c5ba-d1aa-4420-a624-0bb52a57a395'
VIEW = 'a1fdb320-e26a-476e-a947-3bb9549c89ab'
EXCLUDE_LABEL = 'f67828a9-7172-4375-accd-890992162bb2'

def bounds(today):
    monday = today - timedelta(days=today.weekday())
    return monday - timedelta(days=7), today

def filters_for(today):
    start, end = bounds(today)
    return {'start_date': [f'{end.isoformat()};before'],
            'target_date': [f'{start.isoformat()};after']}

def main():
    os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'plane.settings.production')
    import django
    django.setup()
    from django.db import transaction
    from plane.db.models import IssueView, Issue
    from plane.utils.issue_filters import issue_filters
    today = datetime.now(ZoneInfo('Asia/Shanghai')).date()
    start, end = bounds(today)
    filters = filters_for(today)
    # This CE build exposes date ranges, not single-sided date comparisons.
    # Use the complete supported Python/ISO date domain as the open ends.
    rich = {'and': [{'start_date__range': f'0001-01-01,{end}'},
                    {'target_date__range': f'{start},9999-12-31'},
                    {'not': {'label_id__in': EXCLUDE_LABEL}}]}
    with transaction.atomic():
        view = IssueView.objects.select_for_update().get(
            id=VIEW, project_id=PROJECT, workspace__slug='ai-strategy', deleted_at__isnull=True)
        expected_name = '周会汇报 · 上周至今'
        description = f'汇报区间：{start} 至 {end}（上海时区，上周一到今天）。筛选开始日期≤今天且目标日期≥上周一；缺少任一日期不显示；排除带“不显示在周报”标签的工作项；状态不限；默认折叠子工作项；父项不符合筛选时，合格子项作为可见入口。每日自动更新，切换回来或刷新页面读取最新配置。'
        display = {**view.display_filters, 'sub_issue': False}
        if view.filters != filters or view.rich_filters != rich or view.description != description or view.name != expected_name or view.display_filters != display:
            view.filters = filters
            view.rich_filters = rich
            view.name = expected_name
            view.description = description
            view.display_filters = display
            view.save(update_fields=['filters', 'rich_filters', 'name', 'description', 'display_filters', 'updated_at'])
    # Verify the same date and parent constraints used by the default view.
    query = issue_filters({**{key: ','.join(value) for key, value in filters.items()}, 'sub_issue': 'false'}, 'GET')
    excluded = Issue.objects.filter(project_id=PROJECT, label_issue__label_id=EXCLUDE_LABEL, label_issue__deleted_at__isnull=True).values_list('id', flat=True)
    from django.db.models import Exists, OuterRef
    query.pop('parent__isnull', None)
    matching = Issue.issue_objects.filter(project_id=PROJECT, **query).exclude(id__in=excluded)
    actual = set(matching.annotate(matching_parent=Exists(matching.filter(id=OuterRef('parent_id')))).filter(matching_parent=False).values_list('id', flat=True))
    rows = list(Issue.issue_objects.filter(project_id=PROJECT, start_date__lte=end, target_date__gte=start).exclude(id__in=excluded).values_list('id', 'parent_id'))
    matched_ids = {item for item, parent in rows}
    expected = {item for item, parent in rows if parent not in matched_ids}
    assert actual == expected, 'Filter read-back mismatch'
    saved = IssueView.objects.get(id=VIEW)
    assert saved.filters == filters
    assert saved.rich_filters == rich
    assert saved.display_filters['sub_issue'] is False
    print(json.dumps({'week_start': str(start), 'week_end': str(end), 'matching_tasks': len(actual),
                      'view': str(saved.id), 'verified': True}))

if __name__ == '__main__':
    main()
