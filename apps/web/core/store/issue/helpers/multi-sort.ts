/**
 * Apply ordered sort criteria from lowest to highest priority.
 * Each sort pass must preserve the input order for equal values so higher
 * priority fields can be layered on without erasing lower priority ordering.
 */
export const sortWithOrderedCriteria = <T, TCriterion>(
  items: T[],
  criteria: readonly TCriterion[],
  sortBy: (items: T[], criterion: TCriterion, preserveInputOrder: boolean) => T[]
): T[] => {
  let sortedItems = items;
  for (let index = criteria.length - 1; index >= 0; index--) {
    sortedItems = sortBy(sortedItems, criteria[index], true);
  }
  return sortedItems;
};
