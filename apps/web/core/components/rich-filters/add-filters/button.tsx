/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import React from "react";
import { observer } from "mobx-react";
import { ListFilter } from "lucide-react";
// plane imports
import type { TButtonSize, TButtonVariant } from "@plane/propel/button";
import { getButtonStyling } from "@plane/propel/button";
import type { IFilterInstance } from "@plane/shared-state";
import type { TExternalFilter, TFilterProperty, TSupportedOperators } from "@plane/types";
import { LOGICAL_OPERATOR } from "@plane/types";
import { cn } from "@plane/utils";
// local imports
import { AddFilterDropdown } from "./dropdown";

export type TAddFilterButtonProps<P extends TFilterProperty, E extends TExternalFilter> = {
  groupOperator?: "and" | "or";
  parentGroupId?: string | null;
  buttonConfig?: {
    label: string | null;
    variant?: TButtonVariant;
    size?: TButtonSize;
    className?: string;
    defaultOpen?: boolean;
    iconConfig?: {
      shouldShowIcon: boolean;
      iconComponent?: React.ElementType;
    };
    isDisabled?: boolean;
  };
  filter: IFilterInstance<P, E>;
  onFilterSelect?: (id: string) => void;
};

export const AddFilterButton = observer(function AddFilterButton<P extends TFilterProperty, E extends TExternalFilter>(
  props: TAddFilterButtonProps<P, E>
) {
  const { filter, buttonConfig, onFilterSelect, parentGroupId, groupOperator } = props;
  const {
    variant = "secondary",
    size = "base",
    className,
    label,
    iconConfig = { shouldShowIcon: true },
    isDisabled = false,
  } = buttonConfig || {};
  // derived values
  const FilterIcon = iconConfig.iconComponent || ListFilter;

  const handleFilterSelect = (property: P, operator: TSupportedOperators, isNegation: boolean) => {
    const rootOperator =
      groupOperator ??
      (filter.expression?.type === "group" && filter.expression.logicalOperator === LOGICAL_OPERATOR.OR
        ? LOGICAL_OPERATOR.OR
        : LOGICAL_OPERATOR.AND);
    const condition = { property, operator, value: undefined };
    if (parentGroupId !== undefined) {
      filter.addConditionToGroup(parentGroupId, rootOperator, condition, isNegation);
    } else {
      filter.addCondition(rootOperator, condition, isNegation);
    }
    onFilterSelect?.(property);
  };

  if (isDisabled) return null;
  return (
    <AddFilterDropdown
      {...props}
      buttonConfig={{
        ...buttonConfig,
        className: cn(getButtonStyling(variant, size), "py-[5px]", className),
      }}
      handleFilterSelect={handleFilterSelect}
      customButton={
        <div className="flex items-center gap-1">
          {iconConfig.shouldShowIcon && <FilterIcon className="size-4 text-secondary" />}
          {label}
        </div>
      }
    />
  );
});
