/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

// plane imports
import { isEmpty } from "lodash-es";
import type {
  SingleOrArray,
  TFilterExpression,
  TFilterValue,
  TSupportedOperators,
  TWorkItemFilterConditionData,
  TWorkItemFilterConditionKey,
  TWorkItemFilterExpression,
  TWorkItemFilterExpressionData,
  TWorkItemFilterProperty,
} from "@plane/types";
import { CORE_OPERATORS, LOGICAL_OPERATOR, MULTI_VALUE_OPERATORS, WORK_ITEM_FILTER_PROPERTY_KEYS } from "@plane/types";
import {
  createConditionNode,
  createAndGroupNode,
  createNotGroupNode,
  createOrGroupNode,
  isAndGroupNode,
  isConditionNode,
  isNotGroupNode,
  isOrGroupNode,
  isUnsupportedNode,
  createUnsupportedNode,
} from "@plane/utils";
// local imports
import { FilterAdapter } from "../rich-filters/adapter";

class WorkItemFiltersAdapter extends FilterAdapter<TWorkItemFilterProperty, TWorkItemFilterExpression> {
  /**
   * Converts external work item filter expression to internal filter tree
   * @param externalFilter - The external filter expression
   * @returns Internal filter expression or null
   */
  toInternal(externalFilter: TWorkItemFilterExpression): TFilterExpression<TWorkItemFilterProperty> | null {
    if (!externalFilter || isEmpty(externalFilter)) return null;

    try {
      return this._convertExpressionToInternal(externalFilter);
    } catch (error) {
      console.error("Failed to convert external filter to internal:", error);
      return createUnsupportedNode<TWorkItemFilterProperty>(
        externalFilter,
        "无法识别已保存的筛选规则，原始规则已保留。"
      );
    }
  }

  /**
   * Recursively converts external expression data to internal filter tree
   * @param expression - The external expression data
   * @returns Internal filter expression
   */
  private _convertExpressionToInternal(
    expression: TWorkItemFilterExpressionData
  ): TFilterExpression<TWorkItemFilterProperty> {
    if (!expression || isEmpty(expression)) {
      return createUnsupportedNode(expression, "筛选规则为空或格式无效。");
    }

    // Check if it's a simple condition (has field property)
    if (this._isWorkItemFilterConditionData(expression)) {
      const conditions = Object.entries(expression).map(([key, value]) => {
        const conditionResult = this._extractWorkItemFilterConditionData({ [key]: value });
        if (!conditionResult)
          return createUnsupportedNode<TWorkItemFilterProperty>({ [key]: value }, "无法识别此筛选条件。");

        const [property, operator, conditionValue] = conditionResult;
        const conditionNode = createConditionNode({
          property,
          operator,
          value: operator === "isnull" ? true : conditionValue,
        });
        return operator === "isnull" && conditionValue === false ? createNotGroupNode(conditionNode) : conditionNode;
      });
      return conditions.length === 1 ? conditions[0] : createAndGroupNode(conditions);
    }

    // It's a logical group - check which type. Keep NOT as a real unary node so
    // older saved filters such as `{ not: { label_id__in: "..." } }` roundtrip.
    const expressionKeys = Object.keys(expression);

    if (LOGICAL_OPERATOR.AND in expression) {
      const andExpression = expression as { [LOGICAL_OPERATOR.AND]: TWorkItemFilterExpressionData[] };
      const andConditions = andExpression[LOGICAL_OPERATOR.AND];

      if (!Array.isArray(andConditions)) return createUnsupportedNode(expression, "AND 条件组格式无效。");

      const convertedConditions = andConditions.map((item) => this._convertExpressionToInternal(item));
      return createAndGroupNode(convertedConditions);
    }

    if (LOGICAL_OPERATOR.OR in expression) {
      const values = (expression as { [LOGICAL_OPERATOR.OR]: TWorkItemFilterExpressionData[] })[LOGICAL_OPERATOR.OR];
      if (!Array.isArray(values)) return createUnsupportedNode(expression, "OR 条件组格式无效。");
      return createOrGroupNode(values.map((item) => this._convertExpressionToInternal(item)));
    }

    if (LOGICAL_OPERATOR.NOT in expression) {
      const value = (expression as { [LOGICAL_OPERATOR.NOT]: TWorkItemFilterExpressionData })[LOGICAL_OPERATOR.NOT];
      if (!value || typeof value !== "object") return createUnsupportedNode(expression, "NOT 条件格式无效。");
      return createNotGroupNode(this._convertExpressionToInternal(value));
    }

    return createUnsupportedNode(expression, `无法识别的筛选结构：${expressionKeys.join(", ")}`);
  }

  /**
   * Converts internal filter expression to external format
   * @param internalFilter - The internal filter expression
   * @returns External filter expression
   */
  toExternal(internalFilter: TFilterExpression<TWorkItemFilterProperty> | null): TWorkItemFilterExpression {
    if (!internalFilter) {
      return {};
    }

    // If serialization encounters an invalid internal node, fail the caller's
    // save/update operation instead of silently turning the user's filters into `{}`.
    return this._convertExpressionToExternal(internalFilter);
  }

  /**
   * Recursively converts internal expression to external format
   * @param expression - The internal filter expression
   * @returns External expression data
   */
  private _convertExpressionToExternal(
    expression: TFilterExpression<TWorkItemFilterProperty>
  ): TWorkItemFilterExpressionData {
    if (isConditionNode(expression)) {
      return this._createWorkItemFilterConditionData(expression.property, expression.operator, expression.value);
    }

    if (isUnsupportedNode(expression)) return expression.externalData as TWorkItemFilterExpressionData;

    // It's a group node

    if (isAndGroupNode(expression)) {
      return {
        [LOGICAL_OPERATOR.AND]: expression.children.map((child) => this._convertExpressionToExternal(child)),
      } as TWorkItemFilterExpressionData;
    }

    if (isOrGroupNode(expression)) {
      return {
        [LOGICAL_OPERATOR.OR]: expression.children.map((child) => this._convertExpressionToExternal(child)),
      } as TWorkItemFilterExpressionData;
    }

    if (isNotGroupNode(expression)) {
      return {
        [LOGICAL_OPERATOR.NOT]: this._convertExpressionToExternal(expression.children[0]),
      } as TWorkItemFilterExpressionData;
    }

    throw new Error(`Unknown group node type for expression`);
  }

  /**
   * Type guard to check if data is of type TWorkItemFilterConditionData
   * @param data - The data to check
   * @returns True if data is TWorkItemFilterConditionData, false otherwise
   */
  private _isWorkItemFilterConditionData = (data: unknown): data is TWorkItemFilterConditionData => {
    if (!data || typeof data !== "object" || isEmpty(data)) return false;

    const keys = Object.keys(data);
    if (keys.length === 0) return false;

    // Check if any key contains logical operators (would indicate it's a group)
    const hasLogicalOperators = keys.some(
      (key) => key === LOGICAL_OPERATOR.AND || key === LOGICAL_OPERATOR.OR || key === LOGICAL_OPERATOR.NOT
    );
    if (hasLogicalOperators) return false;

    // All keys must match the work item filter condition key pattern
    return keys.every((key) => this._isValidWorkItemFilterConditionKey(key));
  };

  /**
   * Validates if a key is a valid work item filter condition key
   * @param key - The key to validate
   * @returns True if the key is valid
   */
  private _isValidWorkItemFilterConditionKey = (key: string): key is TWorkItemFilterConditionKey => {
    if (typeof key !== "string" || key.length === 0) return false;

    // Find the last occurrence of '__' to separate property from operator
    const lastDoubleUnderscoreIndex = key.lastIndexOf("__");
    if (
      lastDoubleUnderscoreIndex === -1 ||
      lastDoubleUnderscoreIndex === 0 ||
      lastDoubleUnderscoreIndex === key.length - 2
    ) {
      return false;
    }

    const property = key.substring(0, lastDoubleUnderscoreIndex);
    const operator = key.substring(lastDoubleUnderscoreIndex + 2);

    // Validate property is in allowed list
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    if (!WORK_ITEM_FILTER_PROPERTY_KEYS.includes(property as any) && !property.startsWith("customproperty_")) {
      return false;
    }

    // Only emit operators supported by the canonical wire schema. Unknown
    // operators are represented as unsupported leaf nodes and roundtrip raw.
    return Object.values(CORE_OPERATORS).includes(operator as (typeof CORE_OPERATORS)[keyof typeof CORE_OPERATORS]);
  };

  /**
   * Extracts property, operator and value from work item filter condition data
   * @param data - The condition data
   * @returns Tuple of property, operator and value, or null if invalid
   */
  private _extractWorkItemFilterConditionData = (
    data: TWorkItemFilterConditionData
  ): [TWorkItemFilterProperty, TSupportedOperators, SingleOrArray<TFilterValue>] | null => {
    const keys = Object.keys(data);
    if (keys.length !== 1) {
      console.error("Work item filter condition data must have exactly one key");
      return null;
    }

    const key = keys[0];
    if (!this._isValidWorkItemFilterConditionKey(key)) {
      console.error(`Invalid work item filter condition key: ${key}`);
      return null;
    }

    // Find the last occurrence of '__' to separate property from operator
    const lastDoubleUnderscoreIndex = key.lastIndexOf("__");
    const property = key.substring(0, lastDoubleUnderscoreIndex);
    const operator = key.substring(lastDoubleUnderscoreIndex + 2) as TSupportedOperators;

    const rawValue = data[key];

    // Parse comma-separated values
    const parsedValue = MULTI_VALUE_OPERATORS.includes(operator) ? this._parseFilterValue(rawValue) : rawValue;

    return [property as TWorkItemFilterProperty, operator, parsedValue];
  };

  /**
   * Parses filter value from string format
   * @param value - The string value to parse
   * @returns Parsed value as string or array of strings
   */
  private _parseFilterValue = (value: TFilterValue): SingleOrArray<TFilterValue> => {
    if (!value) return value;

    if (typeof value !== "string") return value;

    // Handle empty string
    if (value === "") return value;

    // Split by comma if contains comma, otherwise return as single value
    if (value.includes(",")) {
      // Split and trim each value, filter out empty strings
      const splitValues = value
        .split(",")
        .map((v) => v.trim())
        .filter((v) => v.length > 0);

      // Return single value if only one non-empty value after split
      return splitValues.length === 1 ? splitValues[0] : splitValues;
    }

    return value;
  };

  /**
   * Creates TWorkItemFilterConditionData from property, operator and value
   * @param property - The filter property key
   * @param operator - The filter operator
   * @param value - The filter value
   * @returns The condition data object
   */
  private _createWorkItemFilterConditionData = (
    property: TWorkItemFilterProperty,
    operator: TSupportedOperators,
    value: SingleOrArray<TFilterValue>
  ): TWorkItemFilterConditionData => {
    const conditionKey = `${property}__${operator}`;

    // Convert value to string format
    const stringValue = Array.isArray(value) ? value.join(",") : value;

    return {
      [conditionKey]: stringValue,
    } as TWorkItemFilterConditionData;
  };
}

export const workItemFiltersAdapter = new WorkItemFiltersAdapter();
