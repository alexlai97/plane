import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import path from "node:path";
import { createServer } from "vite";

const appRoot = path.resolve(import.meta.dirname, "../../../..");
const testRoot = path.dirname(import.meta.filename);
const mockedImports = {
  "@plane/constants": `export const ALL_ISSUES = "All Issues"; export const ISSUE_PRIORITIES = [];`,
  "@plane/types": `export const EIssueServiceType = { ISSUES: "issues" }; export const EIssueLayoutTypes = { LIST: "list", KANBAN: "kanban", SPREADSHEET: "spreadsheet", GANTT: "gantt_chart", CALENDAR: "calendar" };`,
  "@plane/utils": `export const convertToISODateString = (value) => value;`,
};

let vite;
let BaseIssuesStore;
let EIssueGroupedAction;
let TestIssuesStore;
let autorun;

before(async () => {
  vite = await createServer({
    configFile: false,
    root: appRoot,
    server: { middlewareMode: true },
    appType: "custom",
    plugins: [
      {
        name: "base-issues-test-import-stubs",
        enforce: "pre",
        resolveId(id) {
          return Object.hasOwn(mockedImports, id) ? `\0test-stub:${id}` : null;
        },
        load(id) {
          if (!id.startsWith("\0test-stub:")) return null;
          return mockedImports[id.slice("\0test-stub:".length)];
        },
      },
    ],
    resolve: {
      alias: [
        { find: "@/services/cycle.service", replacement: `${testRoot}/base-issues-service-stubs.mjs` },
        { find: "@/services/issue", replacement: `${testRoot}/base-issues-service-stubs.mjs` },
        { find: "@/services/module.service", replacement: `${testRoot}/base-issues-service-stubs.mjs` },
        { find: "@/lib/store-context", replacement: `${testRoot}/base-issues-store-context-stub.mjs` },
        { find: /^@\/helpers\//, replacement: `${appRoot}/helpers/` },
        { find: /^@\/app\//, replacement: `${appRoot}/app/` },
        { find: /^@\/(.*)$/, replacement: `${appRoot}/core/$1` },
      ],
    },
  });
  ({ BaseIssuesStore, EIssueGroupedAction } = await vite.ssrLoadModule(
    "/core/store/issue/helpers/base-issues.store.ts"
  ));
  ({ autorun } = await vite.ssrLoadModule("mobx"));
  TestIssuesStore = class extends BaseIssuesStore {
    fetchParentStats() {}
    updateParentStats() {}
  };
});

after(async () => vite?.close());

function makeStore({
  sub_issue = false,
  group_by = "state",
  sub_group_by,
  layout = "list",
  groupedIssueIds,
  groupedIssueCount,
} = {}) {
  const issues = new Map();
  const rootIssueStore = {
    moduleId: undefined,
    cycleId: undefined,
    rootStore: { state: { stateMap: {} } },
    issues: {
      getIssueById: (id) => issues.get(id),
      getIssuesByIds: (ids) => ids.map((id) => issues.get(id)).filter(Boolean),
      updateIssue: (id, data) => issues.set(id, { ...issues.get(id), ...data }),
    },
  };
  const issueFilterStore = {
    issueFilters: { displayFilters: { sub_issue, layout, group_by, sub_group_by, order_by_fields: ["-created_at"] } },
  };
  const store = new TestIssuesStore(rootIssueStore, issueFilterStore);
  // Sorting is orthogonal to membership and is stubbed so this harness only needs
  // the small issue-map surface consumed by the production list update path.
  store.issuesSortWithOrderBy = (ids) => [...ids];
  store.groupedIssueIds = groupedIssueIds ?? { "All Issues": [], state_a: [], state_b: [] };
  store.groupedIssueCount = groupedIssueCount ?? { "All Issues": 0, state_a: 0, state_b: 0 };
  return { store, issues };
}

function issue(id, state_id, extra = {}) {
  return { id, state_id, parent_id: "parent-1", created_at: "2026-01-01T00:00:00Z", ...extra };
}

function counts(store) {
  return Object.fromEntries(Object.entries(store.groupedIssueCount).map(([key, count]) => [key, count]));
}

test("a listed child moved between filtered board groups keeps its server-selected membership", async () => {
  const child = issue("child-1", "state_a");
  const { store, issues } = makeStore({
    groupedIssueIds: { state_a: [child.id], state_b: [] },
    groupedIssueCount: { "All Issues": 1, state_a: 1, state_b: 0 },
  });
  issues.set(child.id, child);

  await store.issueUpdate("workspace", "project", child.id, { state_id: "state_b" }, false);

  assert.deepEqual(store.groupedIssueIds.state_a, []);
  assert.deepEqual(store.groupedIssueIds.state_b, [child.id]);
  assert.deepEqual(counts(store), { "All Issues": 1, state_a: 0, state_b: 1 });
});

test("MobX observers see a listed child transfer groups as one consistent state change", async () => {
  const child = issue("child-observed", "state_a");
  const { store, issues } = makeStore({
    groupedIssueIds: { state_a: [child.id], state_b: [] },
    groupedIssueCount: { "All Issues": 1, state_a: 1, state_b: 0 },
  });
  issues.set(child.id, child);
  const snapshots = [];
  const dispose = autorun(() => {
    snapshots.push({
      state_a: [...store.groupedIssueIds.state_a],
      state_b: [...store.groupedIssueIds.state_b],
    });
  });

  try {
    await store.issueUpdate("workspace", "project", child.id, { state_id: "state_b" }, false);
  } finally {
    dispose();
  }

  assert.deepEqual(snapshots, [
    { state_a: [child.id], state_b: [] },
    { state_a: [], state_b: [child.id] },
  ]);
});

test("a failed patch rolls the child back to its prior group and counts", async () => {
  const child = issue("child-rollback", "state_a");
  const { store, issues } = makeStore({
    groupedIssueIds: { state_a: [child.id], state_b: [] },
    groupedIssueCount: { "All Issues": 1, state_a: 1, state_b: 0 },
  });
  issues.set(child.id, child);
  store.issueService.patchIssue = async () => {
    throw new Error("patch rejected");
  };

  await assert.rejects(store.issueUpdate("workspace", "project", child.id, { state_id: "state_b" }), /patch rejected/);

  assert.deepEqual(issues.get(child.id), child);
  assert.deepEqual(store.groupedIssueIds.state_a, [child.id]);
  assert.deepEqual(store.groupedIssueIds.state_b, []);
  assert.deepEqual(counts(store), { "All Issues": 1, state_a: 1, state_b: 0 });
});

test("a listed child moves through each matching subgroup when its grouped property changes", async () => {
  const child = issue("child-multilabel", "state_a", { label_ids: ["label_x", "label_y"] });
  const { store, issues } = makeStore({
    layout: "kanban",
    sub_group_by: "labels",
    groupedIssueIds: {
      state_a: { label_x: [child.id], label_y: [child.id] },
      state_b: { label_x: [], label_y: [] },
    },
    groupedIssueCount: {
      "All Issues": 1,
      state_a: 1,
      state_b: 0,
      state_a_label_x: 1,
      state_a_label_y: 1,
      state_b_label_x: 0,
      state_b_label_y: 0,
    },
  });
  issues.set(child.id, child);

  await store.issueUpdate("workspace", "project", child.id, { state_id: "state_b" }, false);

  assert.deepEqual(store.groupedIssueIds.state_a, { label_x: [], label_y: [] });
  assert.deepEqual(store.groupedIssueIds.state_b, { label_x: [child.id], label_y: [child.id] });
  assert.deepEqual(counts(store), {
    state_a_label_x: 0,
    state_a_label_y: 0,
    state_b_label_x: 1,
    state_b_label_y: 1,
    state_a: 0,
    state_b: 1,
    "All Issues": 1,
  });
});

test("adding a label group to an already listed child preserves aggregate membership count", async () => {
  const child = issue("child-added-label", "state_a", { label_ids: ["label_a"] });
  const { store, issues } = makeStore({
    group_by: "labels",
    groupedIssueIds: { label_a: [child.id], label_b: [] },
    groupedIssueCount: { "All Issues": 1, label_a: 1, label_b: 0 },
  });
  issues.set(child.id, child);

  await store.issueUpdate("workspace", "project", child.id, { label_ids: ["label_a", "label_b"] }, false);

  assert.deepEqual(store.groupedIssueIds.label_a, [child.id]);
  assert.deepEqual(store.groupedIssueIds.label_b, [child.id]);
  assert.deepEqual(counts(store), { "All Issues": 1, label_a: 1, label_b: 1 });
});

test("adding and removing a label subgroup keeps its top-group count at one", async () => {
  const child = issue("child-same-group-labels", "state_a", { label_ids: ["label_x"] });
  const { store, issues } = makeStore({
    layout: "kanban",
    sub_group_by: "labels",
    groupedIssueIds: { state_a: { label_x: [child.id], label_y: [] } },
    groupedIssueCount: {
      "All Issues": 1,
      state_a: 1,
      state_a_label_x: 1,
      state_a_label_y: 0,
    },
  });
  issues.set(child.id, child);

  await store.issueUpdate("workspace", "project", child.id, { label_ids: ["label_x", "label_y"] }, false);
  assert.deepEqual(store.groupedIssueIds.state_a, { label_x: [child.id], label_y: [child.id] });
  assert.deepEqual(counts(store), {
    "All Issues": 1,
    state_a: 1,
    state_a_label_x: 1,
    state_a_label_y: 1,
  });

  await store.issueUpdate("workspace", "project", child.id, { label_ids: ["label_y"] }, false);
  assert.deepEqual(store.groupedIssueIds.state_a, { label_x: [], label_y: [child.id] });
  assert.deepEqual(counts(store), {
    "All Issues": 1,
    state_a: 1,
    state_a_label_x: 0,
    state_a_label_y: 1,
  });
});

test("moving one child between nested multi-label groups keeps its aggregate count at one", async () => {
  const child = issue("child-assignee", "state_a", { assignee_ids: ["assignee_a"], label_ids: ["label_x", "label_y"] });
  const { store, issues } = makeStore({
    group_by: "assignees",
    layout: "kanban",
    sub_group_by: "labels",
    groupedIssueIds: {
      assignee_a: { label_x: [child.id], label_y: [child.id] },
      assignee_b: { label_x: [], label_y: [] },
    },
    groupedIssueCount: {
      "All Issues": 1,
      assignee_a: 1,
      assignee_b: 0,
      assignee_a_label_x: 1,
      assignee_a_label_y: 1,
      assignee_b_label_x: 0,
      assignee_b_label_y: 0,
    },
  });
  issues.set(child.id, child);

  await store.issueUpdate("workspace", "project", child.id, { assignee_ids: ["assignee_b"] }, false);

  assert.deepEqual(store.groupedIssueIds.assignee_a, { label_x: [], label_y: [] });
  assert.deepEqual(store.groupedIssueIds.assignee_b, { label_x: [child.id], label_y: [child.id] });
  assert.deepEqual(counts(store), {
    "All Issues": 1,
    assignee_a: 0,
    assignee_b: 1,
    assignee_a_label_x: 0,
    assignee_a_label_y: 0,
    assignee_b_label_x: 1,
    assignee_b_label_y: 1,
  });
});

test("an unlisted child remains hidden when its group property changes", async () => {
  const child = issue("child-unlisted", "state_a");
  const { store, issues } = makeStore({
    groupedIssueIds: { "All Issues": [], state_a: [], state_b: [] },
    groupedIssueCount: { "All Issues": 0, state_a: 0, state_b: 0 },
  });
  issues.set(child.id, child);

  await store.issueUpdate("workspace", "project", child.id, { state_id: "state_b" }, false);

  assert.deepEqual(store.groupedIssueIds.state_a, []);
  assert.deepEqual(store.groupedIssueIds.state_b, []);
  assert.deepEqual(counts(store), { "All Issues": 0, state_a: 0, state_b: 0 });
});

test("an implicit update does not add an unlisted regular issue to the filtered view", async () => {
  const root = { id: "root-unlisted", state_id: "state_a", created_at: "2026-01-01T00:00:00Z" };
  const { store, issues } = makeStore({
    groupedIssueIds: { "All Issues": [], state_a: [], state_b: [] },
    groupedIssueCount: { "All Issues": 0, state_a: 0, state_b: 0 },
  });
  issues.set(root.id, root);

  await store.issueUpdate("workspace", "project", root.id, { state_id: "state_b" }, false);

  assert.deepEqual(store.groupedIssueIds.state_a, []);
  assert.deepEqual(store.groupedIssueIds.state_b, []);
  assert.deepEqual(counts(store), { "All Issues": 0, state_a: 0, state_b: 0 });
});

test("regular roots still enter the root and matching group lists", () => {
  const { store } = makeStore();
  const root = { id: "root-1", state_id: "state_a", created_at: "2026-01-01T00:00:00Z" };
  store.rootIssueStore.issues.updateIssue(root.id, root);

  store.updateIssueList(root);

  assert.deepEqual(store.groupedIssueIds.state_a, [root.id]);
  assert.deepEqual(counts(store), { "All Issues": 1, state_a: 1, state_b: 0 });
});

test("show-sub-issues enabled retains normal child add behavior", () => {
  const { store } = makeStore({ sub_issue: true });
  const child = issue("child-visible", "state_a");
  store.rootIssueStore.issues.updateIssue(child.id, child);

  store.updateIssueList(child);

  assert.deepEqual(store.groupedIssueIds.state_a, [child.id]);
});

test("reordering a listed child within one group keeps membership and counts stable", async () => {
  const child = issue("child-reorder", "state_a");
  const { store, issues } = makeStore({
    groupedIssueIds: { state_a: [child.id], state_b: [] },
    groupedIssueCount: { "All Issues": 1, state_a: 1, state_b: 0 },
  });
  issues.set(child.id, child);

  await store.issueUpdate("workspace", "project", child.id, { created_at: "2026-02-01T00:00:00Z" }, false);

  assert.deepEqual(store.groupedIssueIds.state_a, [child.id]);
  assert.deepEqual(counts(store), { "All Issues": 1, state_a: 1, state_b: 0 });
});

test("repeated explicit add and delete operations do not duplicate membership or underflow counts", () => {
  const root = { id: "root-idempotent", state_id: "state_a", created_at: "2026-01-01T00:00:00Z" };
  const { store } = makeStore();
  store.rootIssueStore.issues.updateIssue(root.id, root);

  store.updateIssueList(root, undefined, EIssueGroupedAction.ADD);
  store.updateIssueList(root, undefined, EIssueGroupedAction.ADD);
  assert.deepEqual(store.groupedIssueIds.state_a, [root.id]);
  assert.deepEqual(counts(store), { "All Issues": 1, state_a: 1, state_b: 0 });

  store.updateIssueList(undefined, root, EIssueGroupedAction.DELETE);
  store.updateIssueList(undefined, root, EIssueGroupedAction.DELETE);
  assert.deepEqual(store.groupedIssueIds.state_a, []);
  assert.deepEqual(counts(store), { "All Issues": 0, state_a: 0, state_b: 0 });
});
