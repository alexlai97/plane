import test from "node:test";
import assert from "node:assert/strict";
import { mergeSavedDisplayFilters } from "./merge-display-filters.ts";

test("saving a shortened sort list replaces all old criteria and keeps unrelated metadata", () => {
  const saved = {
    order_by: "-priority",
    order_by_fields: ["-priority", "target_date"],
    view_config_version: 2,
    calendar: { layout: "month", show_weekends: true },
  };
  const next = mergeSavedDisplayFilters(saved, { order_by_fields: ["target_date"], calendar: { layout: "week" } });
  assert.deepEqual(next.order_by_fields, ["target_date"]);
  assert.equal(next.order_by, "target_date");
  assert.equal(next.view_config_version, 2);
  assert.deepEqual(next.calendar, { layout: "week", show_weekends: true });
  assert.deepEqual(saved.order_by_fields, ["-priority", "target_date"]);
});

test("removing every sort returns to manual order without reviving an old scalar", () => {
  const next = mergeSavedDisplayFilters(
    { order_by: "-priority", order_by_fields: ["-priority", "target_date"] },
    { order_by: undefined, order_by_fields: [] }
  );
  assert.deepEqual(next.order_by_fields, []);
  assert.equal(next.order_by, "sort_order");
});
