import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { getGanttBlockElementId, getGanttSidebarElementId } from "./constants.ts";

describe("getGanttBlockElementId", () => {
  it("keeps ungrouped IDs and separates the same work item across groups", () => {
    assert.equal(getGanttBlockElementId("issue-1"), "gantt-block-issue-1");
    assert.notEqual(getGanttBlockElementId("issue-1", "label/a"), getGanttBlockElementId("issue-1", "label-b"));
    assert.equal(getGanttSidebarElementId("issue-1"), "draggable-issue-1");
    assert.notEqual(getGanttSidebarElementId("issue-1", "label/a"), getGanttSidebarElementId("issue-1", "label-b"));
  });
});
