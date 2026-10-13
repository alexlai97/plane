import assert from "node:assert/strict";
import test from "node:test";
import { FilterInstance, workItemFiltersAdapter } from "../dist/index.js";

test("legacy NOT, nested AND/OR and date preset tokens roundtrip", () => {
  const saved = {
    or: [
      { and: [{ state_group__exact: "started" }, { target_date__lte: "previous_monday" }] },
      { not: { label_id__in: "label-1,label-2" } },
    ],
  };

  assert.deepEqual(workItemFiltersAdapter.toExternal(workItemFiltersAdapter.toInternal(saved)), saved);
});

test("isnull false becomes NOT isnull true", () => {
  const saved = { target_date__isnull: false };

  assert.deepEqual(workItemFiltersAdapter.toExternal(workItemFiltersAdapter.toInternal(saved)), {
    not: { target_date__isnull: true },
  });
});

test("selecting an empty operator stores its canonical true value", () => {
  const filter = new FilterInstance({ adapter: workItemFiltersAdapter });

  filter.addCondition("and", { property: "target_date", operator: "isnull", value: undefined }, false);

  assert.deepEqual(workItemFiltersAdapter.toExternal(filter.expression), { target_date__isnull: true });
});

test("unknown saved nodes survive edits and remain savable for backend validation", () => {
  const saved = { and: [{ state_group__exact: "completed" }, { future_field__in: ["x", "y"] }] };
  const filter = new FilterInstance({
    adapter: workItemFiltersAdapter,
    initialExpression: saved,
    options: {
      expression: {
        saveViewOptions: { onViewSave: () => {} },
        updateViewOptions: { hasAdditionalChanges: true, onViewUpdate: () => {} },
      },
    },
  });

  assert.equal(filter.unsupportedNodes.length, 1);
  assert.equal(filter.canSaveView, true);
  assert.equal(filter.canUpdateView, true);
  assert.equal(filter.canClearFilters, true);
  assert.deepEqual(workItemFiltersAdapter.toExternal(filter.expression), saved);

  filter.addCondition("and", { property: "priority", operator: "exact", value: "high" }, false);
  assert.deepEqual(workItemFiltersAdapter.toExternal(filter.expression), {
    and: [{ state_group__exact: "completed" }, { future_field__in: ["x", "y"] }, { priority__exact: "high" }],
  });
  assert.equal(filter.canSaveView, true);
});

test("legacy multi-key condition objects normalize to an AND group", () => {
  const saved = { state_group__exact: "started", priority__in: "urgent,high" };

  assert.deepEqual(workItemFiltersAdapter.toExternal(workItemFiltersAdapter.toInternal(saved)), {
    and: [{ state_group__exact: "started" }, { priority__in: "urgent,high" }],
  });
});

test("negative selection option uses the wire operator when one value displays as exact", () => {
  const filter = new FilterInstance({ adapter: workItemFiltersAdapter });
  filter.configManager.register({
    id: "label_id",
    label: "Labels",
    isEnabled: true,
    allowMultipleFilters: true,
    supportedOperatorConfigsMap: new Map([
      [
        "in",
        {
          type: "multi_select",
          isOperatorEnabled: true,
          allowNegative: true,
          singleValueOperator: "exact",
          getOptions: [],
        },
      ],
    ]),
  });

  const operators = filter.configManager
    .getConfigByProperty("label_id")
    .getAllDisplayOperatorOptionsByValue(["label-1"]);

  assert.ok(operators.some(({ value }) => value === "in"));
  assert.ok(operators.some(({ value }) => value === "not_in"));
  assert.ok(!operators.some(({ value }) => value === "not_exact"));
});

test("adding a nested group and removing it preserves sibling expressions", () => {
  const original = { and: [{ state_group__exact: "started" }, { priority__exact: "high" }] };
  const filter = new FilterInstance({ adapter: workItemFiltersAdapter, initialExpression: original });
  const groupId = filter.addGroup(null, "or");

  assert.ok(groupId);
  filter.addConditionToGroup(groupId, "or", { property: "target_date", operator: "lte", value: "today" });
  assert.deepEqual(workItemFiltersAdapter.toExternal(filter.expression), {
    and: [{ state_group__exact: "started" }, { priority__exact: "high" }, { or: [{ target_date__lte: "today" }] }],
  });

  filter.removeCondition(groupId);
  assert.deepEqual(workItemFiltersAdapter.toExternal(filter.expression), original);
});
