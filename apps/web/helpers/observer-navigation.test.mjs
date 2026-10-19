import { test } from "node:test";
import assert from "node:assert/strict";
import {
  beginSummaryLoad,
  failSummaryLoad,
  isSummaryLoadCurrent,
  resolveObserverRoute,
  resolveSummaryLoad,
  summaryItemsMatchProjectScope,
  summaryViewMatchesScope,
} from "./observer-navigation.ts";

const slug = "acme";
const policy = {
  capabilities: ["workspace.summary.read", "view.summary.read", "work_item.summary.read", "artifact.published.read"],
  project_ids: ["project-a"],
  view_ids: ["view-a"],
};

test("observer route matrix admits only scoped saved views and published gallery paths", () => {
  assert.deepEqual(resolveObserverRoute(slug, "/acme/", "", policy), { kind: "home" });
  assert.deepEqual(resolveObserverRoute(slug, "/acme/workspace-views/view-a", "", policy), {
    kind: "summary-view",
    viewId: "view-a",
  });
  assert.deepEqual(resolveObserverRoute(slug, "/acme/projects/project-a/views/view-a", "", policy), {
    kind: "project-summary-view",
    projectId: "project-a",
    viewId: "view-a",
  });
  assert.deepEqual(resolveObserverRoute(slug, "/acme/projects/project-b/views/view-a", "", policy), { kind: "denied" });
  assert.deepEqual(resolveObserverRoute(slug, "/acme/projects/project-a/views/view-b", "", policy), { kind: "denied" });
  assert.deepEqual(resolveObserverRoute(slug, "/acme/projects/project-a/issues/issue-a", "", policy), {
    kind: "denied",
  });
  assert.deepEqual(resolveObserverRoute(slug, "/acme/gallery/artifact-a", "", policy), { kind: "gallery" });
  assert.deepEqual(resolveObserverRoute(slug, "/acme/gallery/manage", "", policy), { kind: "denied" });
  assert.deepEqual(resolveObserverRoute(slug, "/acme/gallery/artifact-a", "?view=draft", policy), { kind: "denied" });
});

test("observer cannot open saved summaries without every summary capability and grant", () => {
  const partial = { ...policy, capabilities: ["workspace.summary.read", "view.summary.read"] };
  assert.deepEqual(resolveObserverRoute(slug, "/acme/workspace-views/view-a", "", partial), { kind: "denied" });
  const ungranted = { ...policy, view_ids: [] };
  assert.deepEqual(resolveObserverRoute(slug, "/acme/workspace-views/view-a", "", ungranted), { kind: "denied" });
});

test("summary load state clears old workspace/view data before a new request", () => {
  const old = resolveSummaryLoad("acme:view-a", { results: ["old private row"] });
  const next = beginSummaryLoad("acme:view-b");
  assert.equal(isSummaryLoadCurrent(old, "acme:view-b"), false);
  assert.equal(isSummaryLoadCurrent(next, "acme:view-b"), true);
  assert.equal(next.data, undefined);
  assert.equal(failSummaryLoad("acme:view-b").data, undefined);
});

test("returned summary view must match the authorized project and requested project", () => {
  assert.equal(summaryViewMatchesScope("project-a", "project-a", ["project-a"]), true);
  assert.equal(summaryViewMatchesScope("project-b", "project-a", ["project-a", "project-b"]), false);
  assert.equal(summaryViewMatchesScope("project-b", undefined, ["project-a"]), false);
});

test("workspace-shared view with null project id requires at least one granted project", () => {
  assert.equal(summaryViewMatchesScope(null, undefined, ["project-a"]), true);
  assert.equal(summaryViewMatchesScope(null, undefined, []), false);
  assert.equal(summaryViewMatchesScope(null, undefined, null), false);
  assert.equal(summaryViewMatchesScope(null, "project-a", ["project-a"]), false);
  assert.equal(
    summaryItemsMatchProjectScope(
      [{ project_id: "project-a" }, { project_id: "project-b" }],
      ["project-a", "project-b"]
    ),
    true
  );
  assert.equal(summaryItemsMatchProjectScope([{ project_id: "project-b" }], ["project-a"]), false);
  assert.equal(
    summaryItemsMatchProjectScope(
      [{ project_id: "project-a", children: [{ project_id: "project-b" }] }],
      ["project-a", "project-b"],
      "project-a"
    ),
    false
  );
});
