/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

// plane imports
import type {
  TFilterConditionPayload,
  TFilterExpression,
  TFilterGroupNode,
  TFilterProperty,
  TFilterValue,
} from "@plane/types";
// local imports
import { createAndGroupNode, createNotGroupNode, createOrGroupNode } from "../../factories/nodes/core";
import { getGroupChildren } from "../../types";
import { isAndGroupNode, isConditionNode, isGroupNode, isUnsupportedNode } from "../../types/core";
import { shouldUnwrapGroup } from "../../validators/shared";
import { transformExpressionTree } from "../transformation/core";

/**
 * Adds an AND condition to the filter expression.
 * @param expression - The current filter expression
 * @param condition - The condition to add
 * @returns The updated filter expression
 */
export const addAndCondition = <P extends TFilterProperty>(
  expression: TFilterExpression<P> | null,
  condition: TFilterExpression<P>
): TFilterExpression<P> => {
  // if no expression, set the new condition
  if (!expression) {
    return condition;
  }
  // if the expression is a condition, convert it to an AND group
  if (isConditionNode(expression) || isUnsupportedNode(expression)) {
    return createAndGroupNode([expression, condition]);
  }
  // if the expression is a group, and the group is an AND group, add the new condition to the group
  if (isGroupNode(expression) && isAndGroupNode(expression)) {
    expression.children.push(condition);
    return expression;
  }
  // if the expression is a group, but not an AND group, create a new AND group and add the new condition to it
  if (isGroupNode(expression) && !isAndGroupNode(expression)) {
    return createAndGroupNode([expression, condition]);
  }
  // Throw error for unexpected expression type
  console.error("Invalid expression type", expression);
  return expression;
};

export const addOrCondition = <P extends TFilterProperty>(
  expression: TFilterExpression<P> | null,
  condition: TFilterExpression<P>
): TFilterExpression<P> => {
  if (!expression) return condition;
  if (isGroupNode(expression) && expression.logicalOperator === "or") {
    expression.children.push(condition);
    return expression;
  }
  return createOrGroupNode([expression, condition]);
};

export const addConditionToGroup = <P extends TFilterProperty>(
  expression: TFilterExpression<P> | null,
  parentGroupId: string | null,
  logicalOperator: "and" | "or",
  condition: TFilterExpression<P>
): TFilterExpression<P> | null => {
  if (!parentGroupId)
    return logicalOperator === "or" ? addOrCondition(expression, condition) : addAndCondition(expression, condition);
  if (!expression) return null;
  const addToTarget = (node: TFilterExpression<P>): boolean => {
    if (!isGroupNode(node)) return false;
    if (node.id === parentGroupId) {
      if (node.logicalOperator === "not") return false;
      if (node.logicalOperator === logicalOperator) node.children.push(condition);
      else {
        const replacement = logicalOperator === "or" ? createOrGroupNode([condition]) : createAndGroupNode([condition]);
        node.children.push(replacement);
      }
      return true;
    }
    return getGroupChildren(node).some((child) => addToTarget(child));
  };
  addToTarget(expression);
  return expression;
};

export const addGroupToExpression = <P extends TFilterProperty>(
  expression: TFilterExpression<P> | null,
  parentGroupId: string | null,
  logicalOperator: "and" | "or",
  groupId?: string
): TFilterExpression<P> => {
  const group = logicalOperator === "or" ? createOrGroupNode<P>([]) : createAndGroupNode<P>([]);
  if (groupId) group.id = groupId;
  if (!parentGroupId) {
    if (!expression) return group;
    if (isGroupNode(expression) && expression.logicalOperator !== "not") {
      expression.children.push(group);
      return expression;
    }
    return createAndGroupNode([expression, group]);
  }
  if (!expression) return group;
  const append = (node: TFilterExpression<P>): boolean => {
    if (!isGroupNode(node)) return false;
    if (node.id === parentGroupId && node.logicalOperator !== "not") {
      node.children.push(group);
      return true;
    }
    return getGroupChildren(node).some((child) => append(child));
  };
  append(expression);
  return expression;
};

export const setRootGroupOperator = <P extends TFilterProperty>(
  expression: TFilterExpression<P> | null,
  logicalOperator: "and" | "or"
): TFilterExpression<P> | null => {
  if (!expression) return null;
  if (isGroupNode(expression) && expression.logicalOperator !== "not") {
    expression.logicalOperator = logicalOperator;
    return expression;
  }
  const group = logicalOperator === "or" ? createOrGroupNode([expression]) : createAndGroupNode([expression]);
  return group;
};

export const updateGroupOperator = <P extends TFilterProperty>(
  expression: TFilterExpression<P> | null,
  groupId: string,
  logicalOperator: "and" | "or"
): TFilterExpression<P> | null => {
  if (!expression || !isGroupNode(expression)) return expression;
  if (expression.id === groupId) {
    if (expression.logicalOperator !== "not") expression.logicalOperator = logicalOperator;
    return expression;
  }
  for (const child of getGroupChildren(expression)) {
    if (isGroupNode(child) && findGroupById(child, groupId)) {
      updateGroupOperator(child, groupId, logicalOperator);
      break;
    }
  }
  return expression;
};

const findGroupById = <P extends TFilterProperty>(node: TFilterExpression<P>, groupId: string): boolean => {
  if (!isGroupNode(node)) return false;
  return node.id === groupId || getGroupChildren(node).some((child) => findGroupById(child, groupId));
};

export const setConditionNegation = <P extends TFilterProperty>(
  expression: TFilterExpression<P> | null,
  conditionId: string,
  shouldNegate: boolean
): TFilterExpression<P> | null => {
  if (!expression) return expression;
  if (isConditionNode(expression)) {
    return expression.id === conditionId && shouldNegate ? createNotGroupNode(expression) : expression;
  }
  if (!isGroupNode(expression)) return expression;
  if (
    expression.logicalOperator === "not" &&
    isConditionNode(expression.children[0]) &&
    expression.children[0].id === conditionId
  ) {
    return shouldNegate ? expression : expression.children[0];
  }
  expression.children = getGroupChildren(expression).map((child) => {
    if (isConditionNode(child) && child.id === conditionId) {
      return shouldNegate ? createNotGroupNode(child) : child;
    }
    if (isGroupNode(child)) return setConditionNegation(child, conditionId, shouldNegate) ?? child;
    return child;
  });
  return expression;
};

/**
 * Replaces a node in the expression tree with another node.
 * Uses transformExpressionTree for consistent tree processing and better maintainability.
 * @param expression - The expression tree to search in
 * @param targetId - The ID of the node to replace
 * @param replacement - The node to replace with
 * @returns The updated expression tree
 */
export const replaceNodeInExpression = <P extends TFilterProperty>(
  expression: TFilterExpression<P>,
  targetId: string,
  replacement: TFilterExpression<P>
): TFilterExpression<P> => {
  const result = transformExpressionTree(expression, (node: TFilterExpression<P>) => {
    // If this is the node we want to replace, return the replacement
    if (node.id === targetId) {
      return {
        expression: replacement,
        shouldNotify: false,
      };
    }
    // For all other nodes, let the generic transformer handle the recursion
    return { expression: node, shouldNotify: false };
  });

  // Since we're doing a replacement, the result should never be null
  return result.expression || expression;
};

/**
 * Updates a node in the filter expression.
 * Uses recursive tree traversal with proper type handling.
 * @param expression - The filter expression to update
 * @param targetId - The id of the node to update
 * @param updates - The updates to apply to the node
 */
export const updateNodeInExpression = <P extends TFilterProperty>(
  expression: TFilterExpression<P>,
  targetId: string,
  updates: Partial<TFilterConditionPayload<P, TFilterValue>>
) => {
  // Helper function to recursively update nodes
  const updateNode = (node: TFilterExpression<P>): void => {
    if (node.id === targetId) {
      if (!isConditionNode<P, TFilterValue>(node)) {
        console.warn("updateNodeInExpression: targetId matched a group; ignoring updates");
        return;
      }
      Object.assign(node, updates);
      return;
    }

    if (isGroupNode(node)) {
      const children = getGroupChildren(node);
      children.forEach((child) => updateNode(child));
    }
  };

  updateNode(expression);
};

/**
 * Unwraps a group if it meets the unwrapping criteria, otherwise returns the group.
 * @param group - The group node to potentially unwrap
 * @param preserveNotGroups - Whether to preserve NOT groups even with single children
 * @returns The unwrapped child or the original group
 */
export const unwrapGroupIfNeeded = <P extends TFilterProperty>(
  group: TFilterGroupNode<P>,
  preserveNotGroups = true
) => {
  if (shouldUnwrapGroup(group, preserveNotGroups)) {
    const children = getGroupChildren(group);
    return children[0];
  }
  return group;
};
