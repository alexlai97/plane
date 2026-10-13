/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Core logical operators
 */
export const CORE_LOGICAL_OPERATOR = {
  AND: "and",
  OR: "or",
  NOT: "not",
} as const;

/**
 * Core equality operators
 */
export const CORE_EQUALITY_OPERATOR = {
  EXACT: "exact",
  IS_NULL: "isnull",
} as const;

/**
 * Core collection operators
 */
export const CORE_COLLECTION_OPERATOR = {
  IN: "in",
} as const;

/**
 * Core comparison operators
 */
export const CORE_COMPARISON_OPERATOR = {
  RANGE: "range",
  LESS_THAN: "lt",
  LESS_THAN_OR_EQUAL: "lte",
  GREATER_THAN: "gt",
  GREATER_THAN_OR_EQUAL: "gte",
} as const;

/**
 * Core operators that support multiple values
 */
export const CORE_MULTI_VALUE_OPERATORS = [CORE_COLLECTION_OPERATOR.IN, CORE_COMPARISON_OPERATOR.RANGE] as const;

/**
 * All core operators
 */
export const CORE_OPERATORS = {
  ...CORE_EQUALITY_OPERATOR,
  ...CORE_COLLECTION_OPERATOR,
  ...CORE_COMPARISON_OPERATOR,
} as const;

/**
 * All core operators that can be used in filter conditions
 */
export type TCoreSupportedOperators = (typeof CORE_OPERATORS)[keyof typeof CORE_OPERATORS];

/** Operators shown in the editor that are represented on the wire by a NOT group. */
export const CORE_NEGATED_OPERATOR = {
  NOT_EXACT: "not_exact",
  NOT_IN: "not_in",
  NOT_IS_NULL: "not_isnull",
  NOT_RANGE: "not_range",
  NOT_LESS_THAN: "not_lt",
  NOT_LESS_THAN_OR_EQUAL: "not_lte",
  NOT_GREATER_THAN: "not_gt",
  NOT_GREATER_THAN_OR_EQUAL: "not_gte",
} as const;
export type TCoreNegatedOperators = (typeof CORE_NEGATED_OPERATOR)[keyof typeof CORE_NEGATED_OPERATOR];
