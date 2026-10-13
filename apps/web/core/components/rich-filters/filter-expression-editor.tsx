/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import React from "react";
import { observer } from "mobx-react";
import { CircleAlert, X } from "lucide-react";
import type { IFilterInstance } from "@plane/shared-state";
import type { TExternalFilter, TFilterExpression, TFilterProperty, TFilterValue } from "@plane/types";
import { LOGICAL_OPERATOR } from "@plane/types";
import { Button } from "@plane/propel/button";
import { CustomSearchSelect } from "@plane/ui";
import { AddFilterButton } from "./add-filters/button";
import { FilterItem } from "./filter-item/root";

type TFilterExpressionEditorProps<P extends TFilterProperty, E extends TExternalFilter> = {
  filter: IFilterInstance<P, E>;
  node: TFilterExpression<P, TFilterValue>;
  depth?: number;
  isRoot?: boolean;
  isDisabled?: boolean;
};

const GROUP_OPTIONS = [
  { value: LOGICAL_OPERATOR.AND, content: "全部条件", query: "全部条件 and all" },
  { value: LOGICAL_OPERATOR.OR, content: "任一条件", query: "任一条件 or any" },
];

export const FilterExpressionEditor = observer(function FilterExpressionEditor<
  P extends TFilterProperty,
  E extends TExternalFilter,
>(props: TFilterExpressionEditorProps<P, E>) {
  const { filter, node, depth = 0, isRoot = false, isDisabled = false } = props;

  if (node.type === "condition") {
    const displayCondition = filter.allConditionsForDisplay.find((condition) => condition.id === node.id);
    return displayCondition ? (
      <FilterItem condition={displayCondition} filter={filter} isDisabled={isDisabled} />
    ) : null;
  }

  if (node.type === "unsupported") {
    return (
      <div className="flex min-h-9 items-center gap-2 rounded-sm border border-warning-strong/30 bg-warning-subtle px-2 text-12 text-warning-primary">
        <CircleAlert className="size-4 shrink-0" aria-hidden="true" />
        <span className="min-w-0 flex-1 truncate" title={node.error}>
          此规则无法在这里编辑，请核对后保留或移除
        </span>
        {!isDisabled && (
          <Button
            variant="tertiary"
            size="sm"
            className="shrink-0"
            onClick={() => filter.removeCondition(node.id)}
            aria-label="移除此筛选条件"
            title="移除此筛选条件"
          >
            <X className="size-3.5" />
          </Button>
        )}
      </div>
    );
  }

  if (node.logicalOperator === LOGICAL_OPERATOR.NOT) {
    const onlyChild = node.children[0];
    if (onlyChild?.type === "condition") {
      const displayCondition = filter.allConditionsForDisplay.find((condition) => condition.id === onlyChild.id);
      if (displayCondition) {
        return <FilterItem condition={displayCondition} filter={filter} isDisabled={isDisabled} />;
      }
    }
  }

  return (
    <div
      className={`flex min-w-0 flex-col gap-2 rounded-md border border-subtle-1 p-2 ${depth === 0 ? "bg-layer-1" : "bg-surface-1"}`}
      style={{ marginLeft: depth > 0 ? 8 : 0 }}
    >
      <div className="flex flex-wrap items-center gap-2">
        <CustomSearchSelect
          value={node.logicalOperator}
          onChange={(operator: "and" | "or") => {
            if (operator === LOGICAL_OPERATOR.AND || operator === LOGICAL_OPERATOR.OR) {
              filter.updateGroupOperator(node.id, operator);
            }
          }}
          options={GROUP_OPTIONS}
          optionsClassName="w-36"
          maxHeight="sm"
          placement="bottom-start"
          disabled={isDisabled || node.logicalOperator === LOGICAL_OPERATOR.NOT}
          customButtonClassName="flex h-7 items-center rounded-sm border border-subtle bg-surface-1 px-2 text-12 font-medium text-primary hover:bg-layer-2-hover"
          customButton={
            node.logicalOperator === LOGICAL_OPERATOR.NOT
              ? "不符合以下条件"
              : node.logicalOperator === LOGICAL_OPERATOR.OR
                ? "任一条件"
                : "全部条件"
          }
        />
        {!isDisabled && depth < 2 && (
          <CustomSearchSelect
            value=""
            onChange={(operator: "and" | "or") => {
              if (operator === LOGICAL_OPERATOR.AND || operator === LOGICAL_OPERATOR.OR) {
                filter.addGroup(node.id, operator);
              }
            }}
            options={GROUP_OPTIONS.map((option) => ({
              ...option,
              content: option.value === LOGICAL_OPERATOR.OR ? "添加任一条件组" : "添加全部条件组",
            }))}
            optionsClassName="w-44"
            maxHeight="sm"
            placement="bottom-start"
            customButtonClassName="h-7 rounded-sm px-2 text-12 text-secondary hover:bg-layer-2-hover"
            customButton="添加条件组"
          />
        )}
        {!isDisabled && !isRoot && (
          <Button
            variant="tertiary"
            size="sm"
            className="ml-auto"
            onClick={() => filter.removeCondition(node.id)}
            aria-label="移除此条件组"
            title="移除此条件组"
          >
            <X className="size-3.5" />
          </Button>
        )}
      </div>
      <div className="flex min-w-0 flex-col gap-2 border-l border-subtle-1 pl-3">
        {node.children.map((child) => (
          <FilterExpressionEditor
            key={child.id}
            filter={filter}
            node={child}
            depth={depth + 1}
            isDisabled={isDisabled}
          />
        ))}
        {!isDisabled &&
          (node.logicalOperator === LOGICAL_OPERATOR.AND || node.logicalOperator === LOGICAL_OPERATOR.OR) && (
            <AddFilterButton
              filter={filter}
              parentGroupId={node.id}
              groupOperator={node.logicalOperator}
              buttonConfig={{
                label: "添加条件",
                size: "sm",
                iconConfig: { shouldShowIcon: false },
              }}
            />
          )}
      </div>
    </div>
  );
});
