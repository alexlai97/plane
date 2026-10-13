import type { IIssueDisplayFilterOptions } from "@plane/types";

/** Preserve view metadata while replacing user-edited sort lists as a whole. */
export function mergeSavedDisplayFilters(
  saved: IIssueDisplayFilterOptions | undefined,
  current: IIssueDisplayFilterOptions | undefined
): IIssueDisplayFilterOptions {
  const next = { ...saved, ...current, calendar: { ...saved?.calendar, ...current?.calendar } };
  if (current?.order_by_fields !== undefined) {
    next.order_by_fields = [...current.order_by_fields];
    next.order_by = current.order_by_fields[0] ?? "sort_order";
  }
  return next;
}
