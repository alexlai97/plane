export type ObserverRoute =
  | { kind: "home" }
  | { kind: "summary-list" }
  | { kind: "summary-view"; viewId: string }
  | { kind: "project-summary-view"; projectId: string; viewId: string }
  | { kind: "gallery" }
  | { kind: "presentations" }
  | { kind: "denied" };

type RoutePolicy = {
  capabilities: string[];
  project_ids: string[] | null;
  view_ids: string[] | null;
};

const SUMMARY_CAPABILITIES = ["workspace.summary.read", "view.summary.read", "work_item.summary.read"];
const hasSummaryAccess = (capabilities: string[]) =>
  SUMMARY_CAPABILITIES.every((capability) => capabilities.includes(capability));

export function resolveObserverRoute(
  workspaceSlug: string,
  pathname: string,
  search: string,
  policy: RoutePolicy
): ObserverRoute {
  const prefix = `/${encodeURIComponent(workspaceSlug)}`;
  const relative = pathname.startsWith(`${prefix}/`) ? pathname.slice(prefix.length) : "";
  const capabilities = new Set(policy.capabilities ?? []);
  const summaryAllowed = hasSummaryAccess([...capabilities]);
  const projectAllowed = (projectId: string) => policy.project_ids?.includes(projectId) === true;
  const viewAllowed = (viewId: string) => policy.view_ids?.includes(viewId) === true;

  if (relative === "" || relative === "/") return summaryAllowed ? { kind: "home" } : { kind: "denied" };
  if (relative === "/workspace-views" || relative === "/workspace-views/")
    return summaryAllowed ? { kind: "summary-list" } : { kind: "denied" };

  const projectView = relative.match(/^\/projects\/([^/]+)\/views\/([^/]+)\/?$/);
  if (projectView) {
    const [, encodedProjectId, encodedViewId] = projectView;
    const projectId = decodeURIComponent(encodedProjectId);
    const viewId = decodeURIComponent(encodedViewId);
    return summaryAllowed && projectAllowed(projectId) && viewAllowed(viewId)
      ? { kind: "project-summary-view", projectId, viewId }
      : { kind: "denied" };
  }

  const globalView = relative.match(/^\/workspace-views\/([^/]+)\/?$/);
  if (globalView) {
    const viewId = decodeURIComponent(globalView[1]);
    return summaryAllowed && viewAllowed(viewId) ? { kind: "summary-view", viewId } : { kind: "denied" };
  }

  const galleryArtifact = relative.match(/^\/gallery\/([^/]+)\/?$/)?.[1];
  const galleryRoot = relative === "/gallery" || relative === "/gallery/";
  const isDraft = new URLSearchParams(search).get("view") === "draft";
  if (
    (galleryRoot || (galleryArtifact && !["manage", "new"].includes(galleryArtifact))) &&
    capabilities.has("artifact.published.read") &&
    !isDraft
  )
    return { kind: "gallery" };

  const presentation = relative.match(/^\/presentations(?:\/([^/]+))?\/?$/);
  if (presentation && capabilities.has("presentation.published.read") && !isDraft) return { kind: "presentations" };

  return { kind: "denied" };
}

export type SummaryLoadState<T> = { scope: string; status: "loading" | "ready" | "error"; data?: T };

export const beginSummaryLoad = <T>(scope: string): SummaryLoadState<T> => ({ scope, status: "loading" });
export const resolveSummaryLoad = <T>(scope: string, data: T): SummaryLoadState<T> => ({
  scope,
  status: "ready",
  data,
});
export const failSummaryLoad = <T>(scope: string): SummaryLoadState<T> => ({ scope, status: "error" });
export const isSummaryLoadCurrent = <T>(state: SummaryLoadState<T>, scope: string) => state.scope === scope;
export const summaryViewMatchesScope = (
  returnedProjectId: string | null,
  expectedProjectId: string | undefined,
  allowedProjectIds: string[] | null
) => {
  if (expectedProjectId)
    return allowedProjectIds?.includes(expectedProjectId) === true && returnedProjectId === expectedProjectId;
  if (returnedProjectId === null) return (allowedProjectIds?.length ?? 0) > 0;
  return allowedProjectIds?.includes(returnedProjectId) === true;
};

type SummaryProjectItem = { project_id: string; children?: SummaryProjectItem[] };
export function summaryItemsMatchProjectScope(
  items: SummaryProjectItem[],
  allowedProjectIds: string[] | null,
  expectedProjectId?: string
): boolean {
  const allowed = new Set(allowedProjectIds ?? []);
  const isAllowed = (item: SummaryProjectItem): boolean =>
    allowed.has(item.project_id) &&
    (!expectedProjectId || item.project_id === expectedProjectId) &&
    (item.children ?? []).every(isAllowed);
  return items.every(isAllowed);
}
