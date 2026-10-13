/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { set } from "lodash-es";
import { action, computed, makeObservable, observable, runInAction } from "mobx";
import { computedFn } from "mobx-utils";
// plane imports
import { EMPTY_OPERATOR_LABEL } from "@plane/constants";
import type {
  TSupportedOperators,
  TFilterConfig,
  TFilterProperty,
  TFilterValue,
  TOperatorSpecificConfigs,
  TAllAvailableOperatorsForDisplay,
} from "@plane/types";
import { FILTER_FIELD_TYPE } from "@plane/types";
import { CORE_NEGATED_OPERATOR } from "@plane/types";
import {
  getOperatorLabel,
  isDateFilterType,
  getDateOperatorLabel,
  isDateFilterOperator,
  getOperatorForPayload,
} from "@plane/utils";

type TOperatorOptionForDisplay = {
  value: TAllAvailableOperatorsForDisplay;
  label: string;
};

export interface IFilterConfig<P extends TFilterProperty> extends TFilterConfig<P> {
  // computed
  allEnabledSupportedOperators: TSupportedOperators[];
  firstOperator: TSupportedOperators | undefined;
  // computed functions
  getOperatorConfig: (
    operator: TAllAvailableOperatorsForDisplay
  ) => TOperatorSpecificConfigs[keyof TOperatorSpecificConfigs] | undefined;
  getLabelForOperator: (operator: TAllAvailableOperatorsForDisplay | undefined) => string;
  getDisplayOperatorByValue: <T extends TSupportedOperators>(operator: T, value: TFilterValue) => T;
  getAllDisplayOperatorOptionsByValue: (value: TFilterValue) => TOperatorOptionForDisplay[];
  // actions
  mutate: (updates: Partial<TFilterConfig<P>>) => void;
}

export class FilterConfig<P extends TFilterProperty> implements IFilterConfig<P> {
  // observables
  id: IFilterConfig<P>["id"];
  label: IFilterConfig<P>["label"];
  icon?: IFilterConfig<P>["icon"];
  isEnabled: IFilterConfig<P>["isEnabled"];
  supportedOperatorConfigsMap: IFilterConfig<P>["supportedOperatorConfigsMap"];
  allowMultipleFilters: IFilterConfig<P>["allowMultipleFilters"];

  /**
   * Creates a new FilterConfig instance.
   * @param params - The parameters for the filter config.
   */
  constructor(params: TFilterConfig<P>) {
    this.id = params.id;
    this.label = params.label;
    this.icon = params.icon;
    this.isEnabled = params.isEnabled;
    this.supportedOperatorConfigsMap = params.supportedOperatorConfigsMap;
    this.allowMultipleFilters = params.allowMultipleFilters;

    makeObservable(this, {
      id: observable,
      label: observable,
      icon: observable,
      isEnabled: observable,
      supportedOperatorConfigsMap: observable,
      allowMultipleFilters: observable,
      // computed
      allEnabledSupportedOperators: computed,
      firstOperator: computed,
      // actions
      mutate: action,
    });
  }

  // ------------ computed ------------

  /**
   * Returns all supported operators.
   * @returns All supported operators.
   */
  get allEnabledSupportedOperators(): IFilterConfig<P>["allEnabledSupportedOperators"] {
    return Array.from(this.supportedOperatorConfigsMap.entries())
      .filter(([, operatorConfig]) => operatorConfig.isOperatorEnabled)
      .map(([operator]) => operator);
  }

  /**
   * Returns the first operator.
   * @returns The first operator.
   */
  get firstOperator(): IFilterConfig<P>["firstOperator"] {
    return this.allEnabledSupportedOperators[0];
  }

  // ------------ computed functions ------------

  /**
   * Returns the operator config.
   * @param operator - The operator.
   * @returns The operator config.
   */
  getOperatorConfig: IFilterConfig<P>["getOperatorConfig"] = computedFn((operator) =>
    this.supportedOperatorConfigsMap.get(getOperatorForPayload(operator).operator)
  );

  /**
   * Returns the label for an operator.
   * @param operator - The operator.
   * @returns The label for the operator.
   */
  getLabelForOperator: IFilterConfig<P>["getLabelForOperator"] = computedFn((operator) => {
    if (!operator) return EMPTY_OPERATOR_LABEL;

    const operatorConfig = this.getOperatorConfig(operator);

    if (operatorConfig?.operatorLabel) {
      return operatorConfig.operatorLabel;
    }

    if (operatorConfig?.type && isDateFilterType(operatorConfig.type) && isDateFilterOperator(operator)) {
      return getDateOperatorLabel(operator);
    }

    return getOperatorLabel(operator);
  });

  /**
   * Returns the operator for a value.
   * @param value - The value.
   * @returns The operator for the value.
   */
  getDisplayOperatorByValue: IFilterConfig<P>["getDisplayOperatorByValue"] = computedFn((operator, value) => {
    const operatorConfig = this.getOperatorConfig(operator);
    if (operatorConfig?.type === FILTER_FIELD_TYPE.MULTI_SELECT && (Array.isArray(value) ? value.length : 0) <= 1) {
      return operatorConfig.singleValueOperator as typeof operator;
    }
    return operator;
  });

  /**
   * Returns all supported operator options for display in the filter UI.
   * This method filters out operators that are already applied (unless multiple filters are allowed)
   * and includes both positive and negative variants when supported.
   *
   * @param value - The current filter value used to determine the appropriate operator variant
   * @returns Array of operator options with their display labels and values
   */
  getAllDisplayOperatorOptionsByValue: IFilterConfig<P>["getAllDisplayOperatorOptionsByValue"] = computedFn((value) => {
    const operatorOptions: TOperatorOptionForDisplay[] = [];

    // Process each supported operator to build display options
    for (const operator of this.allEnabledSupportedOperators) {
      const displayOperator = this.getDisplayOperatorByValue(operator, value);
      const displayOperatorLabel = this.getLabelForOperator(displayOperator);
      operatorOptions.push({
        value: operator,
        label: displayOperatorLabel,
      });

      const additionalOperatorOption = this._getAdditionalOperatorOptions(operator);
      if (additionalOperatorOption) {
        operatorOptions.push(additionalOperatorOption);
      }
    }

    return operatorOptions;
  });

  // ------------ actions ------------

  /**
   * Mutates the config.
   * @param updates - The updates to apply to the config.
   */
  mutate: IFilterConfig<P>["mutate"] = action((updates) => {
    runInAction(() => {
      for (const key in updates) {
        if (updates.hasOwnProperty(key)) {
          const configKey = key as keyof TFilterConfig<P>;
          set(this, configKey, updates[configKey]);
        }
      }
    });
  });

  // ------------ private helpers ------------

  private _getAdditionalOperatorOptions = (operator: TSupportedOperators): TOperatorOptionForDisplay | undefined => {
    const operatorConfig = this.getOperatorConfig(operator);
    if (!operatorConfig?.allowNegative) return undefined;
    const negatedOperator: Partial<Record<TSupportedOperators, TAllAvailableOperatorsForDisplay>> = {
      exact: CORE_NEGATED_OPERATOR.NOT_EXACT,
      in: CORE_NEGATED_OPERATOR.NOT_IN,
      isnull: CORE_NEGATED_OPERATOR.NOT_IS_NULL,
      range: CORE_NEGATED_OPERATOR.NOT_RANGE,
      lt: CORE_NEGATED_OPERATOR.NOT_LESS_THAN,
      lte: CORE_NEGATED_OPERATOR.NOT_LESS_THAN_OR_EQUAL,
      gt: CORE_NEGATED_OPERATOR.NOT_GREATER_THAN,
      gte: CORE_NEGATED_OPERATOR.NOT_GREATER_THAN_OR_EQUAL,
    };
    // Negate the actual wire operator. A single selected value can display an
    // `in` condition as `exact`, but its negative form must remain `not_in`
    // because there may be no exact operator config for that field.
    const valueForDisplay = negatedOperator[operator];
    if (!valueForDisplay) return undefined;
    return { value: valueForDisplay, label: this.getLabelForOperator(valueForDisplay) };
  };
}
