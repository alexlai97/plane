/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

// plane imports
import type {
  TAllAvailableOperatorsForDisplay,
  TFilterExpression,
  TFilterProperty,
  TSupportedOperators,
} from "@plane/types";
import { CORE_NEGATED_OPERATOR } from "@plane/types";
import { isConditionNode, isGroupNode, isNotGroupNode } from "../../types/core";
import { getGroupChildren } from "../../types/shared";

/**
 * Helper function to get the display operator for a condition.
 * This checks for NOT group context and applies negation if needed.
 * @param operator - The original operator
 * @param expression - The filter expression
 * @param conditionId - The ID of the condition
 * @returns The display operator (possibly negated)
 */
export const getDisplayOperator = <P extends TFilterProperty>(
  operator: TSupportedOperators,
  expression: TFilterExpression<P>,
  conditionId: string
): TAllAvailableOperatorsForDisplay => {
  const negatedById = (node: TFilterExpression<P>, isNegated = false, underCompoundNot = false): boolean => {
    if (isConditionNode(node)) return node.id === conditionId && isNegated && !underCompoundNot;
    if (!isGroupNode(node)) return false;
    if (isNotGroupNode(node)) {
      const child = node.children[0];
      // A leaf-scoped NOT maps cleanly to the editor's "is not" operator.
      // NOT over a compound group does not: distributing it would require
      // De Morgan transformations and would change the visible logic tree.
      if (isConditionNode(child)) return negatedById(child, !isNegated, underCompoundNot);
      return negatedById(child, isNegated, true);
    }
    return getGroupChildren(node).some((child) => negatedById(child, isNegated, underCompoundNot));
  };
  if (!negatedById(expression)) return operator;
  const negatedOperators: Partial<Record<TSupportedOperators, TAllAvailableOperatorsForDisplay>> = {
    exact: CORE_NEGATED_OPERATOR.NOT_EXACT,
    in: CORE_NEGATED_OPERATOR.NOT_IN,
    isnull: CORE_NEGATED_OPERATOR.NOT_IS_NULL,
    range: CORE_NEGATED_OPERATOR.NOT_RANGE,
    lt: CORE_NEGATED_OPERATOR.NOT_LESS_THAN,
    lte: CORE_NEGATED_OPERATOR.NOT_LESS_THAN_OR_EQUAL,
    gt: CORE_NEGATED_OPERATOR.NOT_GREATER_THAN,
    gte: CORE_NEGATED_OPERATOR.NOT_GREATER_THAN_OR_EQUAL,
  };
  return negatedOperators[operator] ?? operator;
};
