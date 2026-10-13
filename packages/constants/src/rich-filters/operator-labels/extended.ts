/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import type { TCoreNegatedOperators, TExtendedSupportedOperators } from "@plane/types";
import { CORE_NEGATED_OPERATOR } from "@plane/types";

/**
 * Extended operator labels
 */
export const EXTENDED_OPERATOR_LABELS_MAP: Record<TExtendedSupportedOperators, string> = {} as const;

/**
 * Extended date-specific operator labels
 */
export const EXTENDED_DATE_OPERATOR_LABELS_MAP: Record<TExtendedSupportedOperators, string> = {} as const;

/**
 * Negated operator labels for all operators
 */
export const NEGATED_OPERATOR_LABELS_MAP: Record<TCoreNegatedOperators, string> = {
  [CORE_NEGATED_OPERATOR.NOT_EXACT]: "不为",
  [CORE_NEGATED_OPERATOR.NOT_IN]: "不属于",
  [CORE_NEGATED_OPERATOR.NOT_IS_NULL]: "不为空",
  [CORE_NEGATED_OPERATOR.NOT_RANGE]: "不介于",
  [CORE_NEGATED_OPERATOR.NOT_LESS_THAN]: "不早于",
  [CORE_NEGATED_OPERATOR.NOT_LESS_THAN_OR_EQUAL]: "晚于",
  [CORE_NEGATED_OPERATOR.NOT_GREATER_THAN]: "不晚于",
  [CORE_NEGATED_OPERATOR.NOT_GREATER_THAN_OR_EQUAL]: "早于",
} as const;

/**
 * Negated date operator labels for all date operators
 */
export const NEGATED_DATE_OPERATOR_LABELS_MAP: Record<
  Extract<TCoreNegatedOperators, "not_exact" | "not_range" | "not_lt" | "not_lte" | "not_gt" | "not_gte">,
  string
> = {
  [CORE_NEGATED_OPERATOR.NOT_EXACT]: "不为",
  [CORE_NEGATED_OPERATOR.NOT_RANGE]: "不介于",
  [CORE_NEGATED_OPERATOR.NOT_LESS_THAN]: "不早于",
  [CORE_NEGATED_OPERATOR.NOT_LESS_THAN_OR_EQUAL]: "晚于",
  [CORE_NEGATED_OPERATOR.NOT_GREATER_THAN]: "不晚于",
  [CORE_NEGATED_OPERATOR.NOT_GREATER_THAN_OR_EQUAL]: "早于",
} as const;
