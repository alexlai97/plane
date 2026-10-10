import { test } from "node:test";
import assert from "node:assert/strict";
import { loadHierarchyPath } from "../../apps/web/core/components/issues/issue-layouts/spreadsheet/hierarchy-path.ts";
const rows = {
  63: { id: "63", name: "纸箱", parent_id: "59", sequence_id: 63 },
  59: { id: "59", name: "50AP(升降)", parent_id: "15", sequence_id: 59 },
  15: { id: "15", name: "说明书、纸箱、标签", parent_id: null, sequence_id: 15 },
};
test("promoted dated child retains ordered complete parent context", async () => {
  assert.deepEqual(
    (await loadHierarchyPath("63", async (id) => rows[id])).map((x) => x.name),
    ["说明书、纸箱、标签", "50AP(升降)", "纸箱"]
  );
});
test("bad circular ancestry terminates without duplicate context", async () => {
  const cyclic = { ...rows, 15: { ...rows["15"], parent_id: "63" } };
  assert.equal((await loadHierarchyPath("63", async (id) => cyclic[id])).length, 3);
});
test("inaccessible parent fails rather than inventing a name", async () => {
  await assert.rejects(
    loadHierarchyPath("63", async () => {
      throw Error("forbidden");
    }),
    /forbidden/
  );
});
