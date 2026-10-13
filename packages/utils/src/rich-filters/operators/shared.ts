/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import type { TAllAvailableOperatorsForDisplay, TSupportedOperators } from "@plane/types";
import { CORE_NEGATED_OPERATOR } from "@plane/types";

/**
 * Result type for operator conversion
 */
export type TOperatorForPayload = {
  operator: TSupportedOperators;
  isNegation: boolean;
};

/**
 * Converts a display operator to the format needed for supported by filter expression condition.
 * @param displayOperator - The operator from the UI
 * @returns Object with supported operator and negation flag
 */
export const getOperatorForPayload = (displayOperator: TAllAvailableOperatorsForDisplay): TOperatorForPayload => {
  const negatedOperatorMap: Partial<Record<TAllAvailableOperatorsForDisplay, TSupportedOperators>> = {
    [CORE_NEGATED_OPERATOR.NOT_EXACT]: "exact",
    [CORE_NEGATED_OPERATOR.NOT_IN]: "in",
    [CORE_NEGATED_OPERATOR.NOT_IS_NULL]: "isnull",
    [CORE_NEGATED_OPERATOR.NOT_RANGE]: "range",
    [CORE_NEGATED_OPERATOR.NOT_LESS_THAN]: "lt",
    [CORE_NEGATED_OPERATOR.NOT_LESS_THAN_OR_EQUAL]: "lte",
    [CORE_NEGATED_OPERATOR.NOT_GREATER_THAN]: "gt",
    [CORE_NEGATED_OPERATOR.NOT_GREATER_THAN_OR_EQUAL]: "gte",
  };
  const operator = negatedOperatorMap[displayOperator] ?? (displayOperator as TSupportedOperators);
  const isNegation = displayOperator in negatedOperatorMap;

  return {
    operator,
    isNegation,
  };
};
