import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { sortWithOrderedCriteria } from "./multi-sort.ts";

describe("sortWithOrderedCriteria", () => {
  it("keeps lower-priority ordering when higher-priority values tie", () => {
    const issues = [
      { id: "A", group: "x", priority: 2, createdAt: 2 },
      { id: "B", group: "y", priority: 1, createdAt: 3 },
      { id: "C", group: "x", priority: 1, createdAt: 1 },
    ];
    const createdAtFallback = issues.toSorted((left, right) => right.createdAt - left.createdAt);
    const result = sortWithOrderedCriteria(
      createdAtFallback,
      ["group", "priority"],
      (items, field, preserveInputOrder) => {
        assert.equal(preserveInputOrder, true);
        return items.toSorted((left, right) => {
          const byField = left[field] < right[field] ? -1 : left[field] > right[field] ? 1 : 0;
          return byField || (preserveInputOrder ? 0 : right.createdAt - left.createdAt);
        });
      }
    );

    assert.deepEqual(
      result.map(({ id }) => id),
      ["C", "A", "B"]
    );
  });
});
