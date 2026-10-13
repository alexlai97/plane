/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import type { TFilterValue } from "../expression";
import type {
  TDateFilterFieldConfig,
  TDateRangeFilterFieldConfig,
  TSingleSelectFilterFieldConfig,
  TMultiSelectFilterFieldConfig,
  TEmptyFilterFieldConfig,
} from "../field-types";
import type { CORE_COLLECTION_OPERATOR, CORE_COMPARISON_OPERATOR, CORE_EQUALITY_OPERATOR } from "../operators";

// ----------------------------- EXACT Operator -----------------------------
export type TCoreExactOperatorConfigs =
  | TSingleSelectFilterFieldConfig<TFilterValue>
  | TDateFilterFieldConfig<TFilterValue>;

// ----------------------------- IN Operator -----------------------------
export type TCoreInOperatorConfigs = TMultiSelectFilterFieldConfig<TFilterValue>;

// ----------------------------- RANGE Operator -----------------------------
export type TCoreRangeOperatorConfigs = TDateRangeFilterFieldConfig<TFilterValue>;
export type TCoreIsNullOperatorConfigs = TEmptyFilterFieldConfig;
export type TCoreDateComparisonOperatorConfigs = TDateFilterFieldConfig<TFilterValue>;

// ----------------------------- Core Operator Specific Configs -----------------------------
export type TCoreOperatorSpecificConfigs = {
  [CORE_EQUALITY_OPERATOR.EXACT]: TCoreExactOperatorConfigs;
  [CORE_EQUALITY_OPERATOR.IS_NULL]: TCoreIsNullOperatorConfigs;
  [CORE_COLLECTION_OPERATOR.IN]: TCoreInOperatorConfigs;
  [CORE_COMPARISON_OPERATOR.RANGE]: TCoreRangeOperatorConfigs;
  [CORE_COMPARISON_OPERATOR.LESS_THAN]: TCoreDateComparisonOperatorConfigs;
  [CORE_COMPARISON_OPERATOR.LESS_THAN_OR_EQUAL]: TCoreDateComparisonOperatorConfigs;
  [CORE_COMPARISON_OPERATOR.GREATER_THAN]: TCoreDateComparisonOperatorConfigs;
  [CORE_COMPARISON_OPERATOR.GREATER_THAN_OR_EQUAL]: TCoreDateComparisonOperatorConfigs;
};
