import { useEffect, useMemo, useState } from "react";
import { Link, Outlet } from "react-router";
import { ChevronRight } from "lucide-react";
import { Avatar, AvatarGroup } from "@plane/ui";
import { getFileURL } from "@plane/utils";
import { useWorkspace } from "@/hooks/store/use-workspace";
import { UserMenuRoot } from "@/components/workspace/sidebar/user-menu-root";
import type { WorkspaceAccessPolicy } from "@/services/access-policy.service";
import { summaryService } from "@/services/summary.service";
import type { SummaryView, SummaryViewItems, SummaryWorkItem } from "@/services/summary.service";
import {
  beginSummaryLoad,
  failSummaryLoad,
  isSummaryLoadCurrent,
  resolveObserverRoute,
  resolveSummaryLoad,
  summaryItemsMatchProjectScope,
  summaryViewMatchesScope,
} from "@/helpers/observer-navigation";
import type { SummaryLoadState } from "@/helpers/observer-navigation";

type Props = { workspaceSlug: string; policy: WorkspaceAccessPolicy; pathname: string; search: string };

function ObserverDenied() {
  return (
    <div className="flex h-full items-center justify-center p-8 text-center">
      <div>
        <h1 className="text-18 font-medium">此页面不可用</h1>
        <p className="mt-2 text-13 text-secondary">汇总访客只能查看已授权的汇总视图和已发布成果。</p>
      </div>
    </div>
  );
}

function SummaryViews({ workspaceSlug, policy }: { workspaceSlug: string; policy: WorkspaceAccessPolicy }) {
  const [load, setLoad] = useState<SummaryLoadState<SummaryView[]>>(() => beginSummaryLoad(workspaceSlug));
  useEffect(() => {
    let active = true;
    setLoad(beginSummaryLoad(workspaceSlug));
    summaryService
      .getViews(workspaceSlug)
      .then((rows) => {
        if (active)
          setLoad(
            resolveSummaryLoad(
              workspaceSlug,
              rows.filter(
                (view) =>
                  policy.view_ids?.includes(view.id) &&
                  summaryViewMatchesScope(view.project_id, undefined, policy.project_ids)
              )
            )
          );
      })
      .catch(() => {
        if (active) setLoad(failSummaryLoad(workspaceSlug));
      });
    return () => {
      active = false;
    };
  }, [workspaceSlug, policy.view_ids, policy.project_ids]);
  if (!isSummaryLoadCurrent(load, workspaceSlug) || load.status === "loading")
    return (
      <p role="status" className="p-8 text-center text-13 text-secondary">
        正在加载汇总视图…
      </p>
    );
  if (load.status === "error")
    return (
      <p role="alert" className="p-8 text-center text-13 text-secondary">
        暂时无法加载汇总视图。
      </p>
    );
  const views = load.data ?? [];
  return (
    <section className="mx-auto w-full max-w-5xl p-6">
      <h1 className="mb-1 text-20 font-semibold">汇总视图</h1>
      <p className="mb-5 text-13 text-secondary">仅显示已授权的保存视图；工作项内容为只读摘要。</p>
      {views.length ? (
        <div className="divide-y divide-subtle rounded-lg border border-subtle">
          {views.map((view) => (
            <Link
              key={view.id}
              to={`/${encodeURIComponent(workspaceSlug)}/workspace-views/${encodeURIComponent(view.id)}`}
              className="flex items-center justify-between gap-4 px-4 py-3 hover:bg-surface-2 focus-visible:outline focus-visible:outline-2"
            >
              <span className="min-w-0">
                <span className="block truncate text-14 font-medium">{view.name}</span>
                <span className="text-12 text-secondary">
                  {view.project_id === null
                    ? "工作区共享视图"
                    : `${view.project_identifier ?? "项目视图"} · ${view.project_name ?? ""}`}
                </span>
              </span>
              <span className="shrink-0 text-12 text-secondary">打开汇总 →</span>
            </Link>
          ))}
        </div>
      ) : (
        <p className="rounded-lg border border-subtle p-6 text-13 text-secondary">当前没有可查看的汇总视图。</p>
      )}
    </section>
  );
}

function SummaryTree({ items, depth = 0 }: { items: SummaryWorkItem[]; depth?: number }) {
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  return (
    <div className={depth ? "ml-5 border-l border-subtle pl-3" : ""}>
      {items.map((item) => {
        const children = item.children ?? [];
        const isExpanded = expanded.has(item.id);
        const toggleExpanded = () =>
          setExpanded((current) => {
            const next = new Set(current);
            if (next.has(item.id)) next.delete(item.id);
            else next.add(item.id);
            return next;
          });
        const row = (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className="text-11 text-secondary">{item.identifier}</span>
            <span className="text-13 font-medium">{item.name}</span>
            {item.context_only && <span className="text-11 text-secondary">上级</span>}
            {item.state?.name && (
              <span className="rounded border border-subtle px-1.5 py-0.5 text-11 text-secondary">
                {item.state.name}
              </span>
            )}
            {item.assignees?.length ? (
              <span className="inline-flex items-center gap-1.5">
                <span className="text-11 text-secondary">负责人</span>
                <AvatarGroup size="sm" showTooltip={false}>
                  {item.assignees.map((assignee) => (
                    <Avatar key={assignee.id} src={getFileURL(assignee.avatar_url ?? "")} name={assignee.name} />
                  ))}
                </AvatarGroup>
              </span>
            ) : null}
            {(item.start_date || item.target_date) && (
              <span className="text-11 text-secondary">
                {item.start_date ?? ""}
                {item.start_date && item.target_date ? " – " : ""}
                {item.target_date ?? ""}
              </span>
            )}
          </div>
        );
        return (
          <div key={item.id} className="border-b border-subtle py-2 last:border-0">
            <div className="flex items-center gap-1">
              {children.length > 0 && (
                <button
                  type="button"
                  className="grid size-4 shrink-0 place-items-center rounded-xs text-placeholder hover:text-tertiary"
                  aria-label={isExpanded ? `收起子工作项：${item.name}` : `展开子工作项：${item.name}`}
                  aria-expanded={isExpanded}
                  onClick={toggleExpanded}
                >
                  <ChevronRight className={`size-3.5 transition-transform ${isExpanded ? "rotate-90" : ""}`} />
                </button>
              )}
              {row}
            </div>
            {children.length > 0 && isExpanded && (
              <div className="mt-1">
                <SummaryTree items={children} depth={depth + 1} />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function SummaryViewPage({
  workspaceSlug,
  viewId,
  projectId,
  policy,
}: {
  workspaceSlug: string;
  viewId: string;
  projectId?: string;
  policy: WorkspaceAccessPolicy;
}) {
  const scope = `${workspaceSlug}:${projectId ?? "workspace"}:${viewId}`;
  const [load, setLoad] = useState<SummaryLoadState<SummaryViewItems>>(() => beginSummaryLoad(scope));
  const permitted =
    policy.view_ids?.includes(viewId) === true && (!projectId || policy.project_ids?.includes(projectId) === true);
  useEffect(() => {
    let active = true;
    if (!permitted) return;
    setLoad(beginSummaryLoad(scope));
    summaryService
      .getViewItems(workspaceSlug, viewId, projectId)
      .then((result) => {
        if (!active) return;
        const projectScopeMatches =
          summaryViewMatchesScope(result.view.project_id, projectId, policy.project_ids) &&
          summaryItemsMatchProjectScope(result.results, policy.project_ids, projectId);
        if (result.view.id !== viewId || !projectScopeMatches) setLoad(failSummaryLoad(scope));
        else setLoad(resolveSummaryLoad(scope, result));
      })
      .catch(() => {
        if (active) setLoad(failSummaryLoad(scope));
      });
    return () => {
      active = false;
    };
  }, [workspaceSlug, viewId, projectId, permitted, scope, policy.project_ids]);
  if (!permitted) return <ObserverDenied />;
  if (!isSummaryLoadCurrent(load, scope) || load.status === "loading")
    return (
      <p role="status" className="p-8 text-center text-13 text-secondary">
        正在加载工作项摘要…
      </p>
    );
  if (load.status === "error")
    return (
      <p role="alert" className="p-8 text-center text-13 text-secondary">
        无法加载此汇总视图，或该视图已不再授权。
      </p>
    );
  const data = load.data;
  if (!data) return <ObserverDenied />;
  return (
    <section className="mx-auto w-full max-w-6xl p-6">
      <Link to={`/${encodeURIComponent(workspaceSlug)}/workspace-views/`} className="text-12 text-link-primary">
        ← 全部汇总视图
      </Link>
      <h1 className="mt-3 text-20 font-semibold">{data.view.name}</h1>
      <p className="mt-1 mb-5 text-12 text-secondary">{data.count} 个匹配工作项 · 只读摘要</p>
      {data.results.length ? (
        <div className="rounded-lg border border-subtle px-4">
          <SummaryTree items={data.results} />
        </div>
      ) : (
        <p className="rounded-lg border border-subtle p-6 text-13 text-secondary">此视图当前没有匹配的工作项。</p>
      )}
    </section>
  );
}

export function ObserverWorkspace({ workspaceSlug, policy, pathname, search }: Props) {
  const { currentWorkspace } = useWorkspace();
  const prefix = `/${encodeURIComponent(workspaceSlug)}`;
  const route = useMemo(
    () => resolveObserverRoute(workspaceSlug, pathname, search, policy),
    [workspaceSlug, pathname, search, policy]
  );
  const summaryAllowed =
    policy.capabilities.includes("workspace.summary.read") &&
    policy.capabilities.includes("view.summary.read") &&
    policy.capabilities.includes("work_item.summary.read");
  const artifactsAllowed = policy.capabilities.includes("artifact.published.read");
  const presentationsAllowed = policy.capabilities.includes("presentation.published.read");
  const relative = pathname.startsWith(`${prefix}/`) ? pathname.slice(prefix.length) : "";
  const observerContent =
    route.kind === "home" || route.kind === "summary-list" ? (
      <SummaryViews workspaceSlug={workspaceSlug} policy={policy} />
    ) : route.kind === "summary-view" ? (
      <SummaryViewPage workspaceSlug={workspaceSlug} viewId={route.viewId} policy={policy} />
    ) : route.kind === "project-summary-view" ? (
      <SummaryViewPage
        workspaceSlug={workspaceSlug}
        projectId={route.projectId}
        viewId={route.viewId}
        policy={policy}
      />
    ) : route.kind === "gallery" ? (
      <Outlet />
    ) : route.kind === "presentations" ? (
      <Outlet />
    ) : (
      <ObserverDenied />
    );

  return (
    <div className="flex size-full overflow-hidden rounded-lg border border-subtle bg-surface-1 text-primary">
      <aside className="flex w-60 shrink-0 flex-col border-r border-subtle bg-surface-1">
        <div className="border-b border-subtle px-4 py-4">
          <div className="truncate text-14 font-semibold">{currentWorkspace?.name ?? "工作区"}</div>
          <div className="mt-1 inline-flex rounded bg-surface-2 px-2 py-0.5 text-11 text-secondary">汇总访客</div>
        </div>
        <nav aria-label="汇总访客导航" className="flex-1 space-y-1 p-3">
          {summaryAllowed && (
            <Link
              to={`${prefix}/workspace-views/`}
              className={`block rounded px-3 py-2 text-13 hover:bg-surface-2 ${relative.startsWith("/workspace-views") ? "bg-surface-2 font-medium" : "text-secondary"}`}
            >
              视图
            </Link>
          )}
          {artifactsAllowed && (
            <Link
              to={`${prefix}/gallery/`}
              className={`block rounded px-3 py-2 text-13 hover:bg-surface-2 ${relative.startsWith("/gallery") ? "bg-surface-2 font-medium" : "text-secondary"}`}
            >
              成果与应用
            </Link>
          )}
          {presentationsAllowed && (
            <Link
              to={`${prefix}/presentations/`}
              className={`block rounded px-3 py-2 text-13 hover:bg-surface-2 ${relative.startsWith("/presentations") ? "bg-surface-2 font-medium" : "text-secondary"}`}
            >
              汇报与演示
            </Link>
          )}
        </nav>
        <div className="border-t border-subtle p-3">
          <UserMenuRoot />
        </div>
      </aside>
      <main className="min-w-0 flex-1 overflow-auto">{observerContent}</main>
    </div>
  );
}
