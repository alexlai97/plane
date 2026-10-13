/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import React, { useState } from "react";
import { observer } from "mobx-react";
import { ArrowDown, ArrowUp, ChevronDown, ChevronUp, Plus, X } from "lucide-react";
import { ISSUE_ORDER_BY_OPTIONS } from "@plane/constants";
import { useTranslation } from "@plane/i18n";
import type { TIssueOrderByOptions } from "@plane/types";
import { FilterHeader } from "@/components/issues/issue-layouts/filters";

type Props = {
  selectedOrderBy: TIssueOrderByOptions | undefined;
  selectedOrderByFields?: TIssueOrderByOptions[] | undefined;
  handleUpdate: (val: TIssueOrderByOptions[]) => void;
  orderByOptions: TIssueOrderByOptions[];
  allowMultiple?: boolean;
};

const oppositeOrder = (value: TIssueOrderByOptions): TIssueOrderByOptions => {
  if (value === "sort_order") return value;
  return (value.startsWith("-") ? value.slice(1) : `-${value}`) as TIssueOrderByOptions;
};

export const FilterOrderBy = observer(function FilterOrderBy(props: Props) {
  const { selectedOrderBy, selectedOrderByFields, handleUpdate, orderByOptions, allowMultiple = true } = props;
  const { t } = useTranslation();
  const [previewEnabled, setPreviewEnabled] = useState(true);
  const selected =
    allowMultiple && selectedOrderByFields?.length ? selectedOrderByFields : selectedOrderBy ? [selectedOrderBy] : [];
  const labels = new Map(ISSUE_ORDER_BY_OPTIONS.map((option) => [option.key, t(option.titleTranslationKey)]));
  const titleFor = (key: TIssueOrderByOptions) =>
    labels.get(key) ?? labels.get(oppositeOrder(key)) ?? String(key).replaceAll("_", " ");
  const availableOptions = allowMultiple
    ? orderByOptions.filter((key) => !selected.includes(key) && !selected.includes(oppositeOrder(key)))
    : [];

  const updateAt = (index: number, value: TIssueOrderByOptions) => {
    const next = [...selected];
    next[index] = value;
    handleUpdate(next);
  };

  const move = (index: number, direction: -1 | 1) => {
    const target = index + direction;
    if (target < 0 || target >= selected.length) return;
    const next = [...selected];
    [next[index], next[target]] = [next[target], next[index]];
    handleUpdate(next);
  };

  return (
    <>
      <FilterHeader
        title={t("common.order_by.label")}
        isPreviewEnabled={previewEnabled}
        handleIsPreviewEnabled={() => setPreviewEnabled(!previewEnabled)}
      />
      {previewEnabled && (
        <div className="space-y-1.5 py-1">
          {selected.map((key, index) => (
            <div key={key} className="flex min-h-8 items-center gap-1.5 rounded-sm bg-layer-1 px-2">
              {allowMultiple && <span className="w-4 shrink-0 text-11 font-medium text-tertiary">{index + 1}</span>}
              <span className="min-w-0 flex-1 truncate text-12 text-secondary">{titleFor(key)}</span>
              <button
                type="button"
                className="grid size-6 place-items-center rounded-sm text-secondary hover:bg-layer-2 hover:text-primary"
                aria-label={key.startsWith("-") ? "降序，切换为升序" : "升序，切换为降序"}
                title={key.startsWith("-") ? "降序" : "升序"}
                disabled={key === "sort_order"}
                onClick={() => updateAt(index, oppositeOrder(key))}
              >
                {key.startsWith("-") ? <ArrowDown className="size-3.5" /> : <ArrowUp className="size-3.5" />}
              </button>
              {allowMultiple && (
                <button
                  type="button"
                  className="grid size-6 place-items-center rounded-sm text-secondary hover:bg-layer-2 hover:text-primary disabled:opacity-30"
                  aria-label="上移排序条件"
                  disabled={index === 0}
                  onClick={() => move(index, -1)}
                >
                  <ChevronUp className="size-3.5" />
                </button>
              )}
              {allowMultiple && (
                <button
                  type="button"
                  className="grid size-6 place-items-center rounded-sm text-secondary hover:bg-layer-2 hover:text-primary disabled:opacity-30"
                  aria-label="下移排序条件"
                  disabled={index === selected.length - 1}
                  onClick={() => move(index, 1)}
                >
                  <ChevronDown className="size-3.5" />
                </button>
              )}
              {allowMultiple && (
                <button
                  type="button"
                  className="grid size-6 place-items-center rounded-sm text-secondary hover:bg-layer-2 hover:text-primary"
                  aria-label="移除排序条件"
                  onClick={() => handleUpdate(selected.filter((_, selectedIndex) => selectedIndex !== index))}
                >
                  <X className="size-3.5" />
                </button>
              )}
            </div>
          ))}
          {availableOptions.length > 0 && (
            <details className="group">
              <summary className="flex cursor-pointer list-none items-center gap-1.5 rounded-sm px-2 py-1.5 text-12 text-secondary hover:bg-layer-1">
                <Plus className="size-3.5" />
                <span>添加排序条件</span>
              </summary>
              <div className="max-h-48 overflow-y-auto py-1">
                {availableOptions.map((key) => (
                  <button
                    key={key}
                    type="button"
                    className="block w-full rounded-sm px-3 py-1.5 text-left text-12 text-secondary hover:bg-layer-1 hover:text-primary"
                    onClick={() => handleUpdate([...selected, key])}
                  >
                    {titleFor(key)}
                  </button>
                ))}
              </div>
            </details>
          )}
        </div>
      )}
    </>
  );
});
