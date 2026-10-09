import { test } from "node:test";
import assert from "node:assert/strict";
import { nextPeekTrail } from "../../apps/web/helpers/peek-navigation.ts";
const item = (issueId, workspaceSlug = "ai-strategy", projectId = "project") => ({ issueId, workspaceSlug, projectId });
test("parent, child and related navigation keep a return trail", () => {
  const parent = item("parent"),
    child = item("child"),
    related = item("related");
  const first = nextPeekTrail([], parent, child);
  assert.deepEqual(nextPeekTrail(first, child, related), [parent, child]);
  assert.deepEqual(nextPeekTrail([parent, child], related, child), [parent]);
  assert.deepEqual(nextPeekTrail([parent], child, parent), []);
});
test("close, fresh entry and another workspace reset the trail", () => {
  assert.deepEqual(nextPeekTrail([item("old")], item("current"), undefined), []);
  assert.deepEqual(nextPeekTrail([item("old")], undefined, item("new")), []);
  assert.deepEqual(nextPeekTrail([item("old")], item("current"), item("new", "other")), []);
});
test("same item is not duplicated and project identity matters", () => {
  const a = item("a");
  assert.deepEqual(nextPeekTrail([item("old")], a, a), [item("old")]);
  assert.deepEqual(nextPeekTrail([], a, item("a", "ai-strategy", "other-project")), [a]);
});
test("long navigation is bounded", () => {
  const trail = Array.from({ length: 30 }, (_, i) => item(String(i)));
  const next = nextPeekTrail(trail, item("current"), item("next"));
  assert.equal(next.length, 30);
  assert.equal(next[0].issueId, "1");
  assert.equal(next.at(-1).issueId, "current");
});
