/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import React from "react";
import { observer } from "mobx-react";
import { CalendarDays, X } from "lucide-react";
// plane imports
import type { TDateFilterFieldConfig, TFilterConditionNodeForDisplay, TFilterProperty } from "@plane/types";
import { CustomSearchSelect } from "@plane/ui";
import { cn, renderFormattedPayloadDate } from "@plane/utils";
import { DateDropdown } from "@/components/dropdowns/date";
import { COMMON_FILTER_ITEM_BORDER_CLASSNAME, EMPTY_FILTER_PLACEHOLDER_TEXT } from "../../shared";

type TSingleDateFilterValueInputProps<P extends TFilterProperty> = {
  config: TDateFilterFieldConfig<string>;
  condition: TFilterConditionNodeForDisplay<P, string>;
  isDisabled?: boolean;
  onChange: (value: string | null | undefined) => void;
};

export const SingleDateFilterValueInput = observer(function SingleDateFilterValueInput<P extends TFilterProperty>(
  props: TSingleDateFilterValueInputProps<P>
) {
  const { config, condition, isDisabled, onChange } = props;
  // derived values
  const conditionValue = typeof condition.value === "string" ? condition.value : null;
  const relativeDateOptions = [
    { value: "today", content: "今天", query: "今天 today" },
    { value: "yesterday", content: "昨天", query: "昨天 yesterday" },
    { value: "tomorrow", content: "明天", query: "明天 tomorrow" },
    { value: "previous_monday", content: "上周一", query: "上周一 previous monday" },
    { value: "this_monday", content: "本周一", query: "本周一 this monday" },
    { value: "next_monday", content: "下周一", query: "下周一 next monday" },
    { value: "previous_sunday", content: "上周日", query: "上周日 previous sunday" },
    { value: "this_sunday", content: "本周日", query: "本周日 this sunday" },
    { value: "month_start", content: "本月 1 日", query: "本月1日 month start" },
    { value: "previous_month_start", content: "上月 1 日", query: "上月1日 previous month start" },
    { value: "one_week_ago", content: "7 天前", query: "7天前 one week ago" },
  ];
  const relativeLabel = relativeDateOptions.find((option) => option.value === conditionValue)?.content;
  const isRelativeValue = !!relativeLabel;
  const hasUnknownValue = !!conditionValue && !isRelativeValue && Number.isNaN(Date.parse(conditionValue));

  return (
    <div className="flex h-full items-stretch">
      {isRelativeValue || hasUnknownValue ? (
        <button
          type="button"
          className={cn("flex h-full items-center gap-1 px-2 text-13 hover:bg-layer-2-hover", {
            [COMMON_FILTER_ITEM_BORDER_CLASSNAME]: !isDisabled,
            "cursor-not-allowed opacity-60": isDisabled,
            "text-warning-primary": hasUnknownValue,
            "text-primary": isRelativeValue,
          })}
          aria-label={hasUnknownValue ? "清除未识别日期值" : "清除相对日期并选择具体日期"}
          title={
            hasUnknownValue ? "此日期值无法识别；原值已保留。点击清除后可重新选择。" : "清除相对日期并选择具体日期"
          }
          disabled={isDisabled}
          onClick={() => onChange(null)}
        >
          {relativeLabel ?? `未识别：${conditionValue}`}
          <X className="size-3 text-tertiary" aria-hidden="true" />
        </button>
      ) : (
        <DateDropdown
          value={conditionValue}
          onChange={(value: Date | null) => {
            const formattedDate = value ? renderFormattedPayloadDate(value) : null;
            onChange(formattedDate);
          }}
          buttonClassName={cn("rounded-none", {
            [COMMON_FILTER_ITEM_BORDER_CLASSNAME]: !isDisabled,
            "text-placeholder": !conditionValue,
            "hover:bg-surface-1": isDisabled,
          })}
          minDate={config.min}
          maxDate={config.max}
          icon={null}
          placeholder={EMPTY_FILTER_PLACEHOLDER_TEXT}
          buttonVariant="transparent-with-text"
          isClearable={false}
          closeOnSelect
          defaultOpen={!conditionValue}
          disabled={isDisabled}
        />
      )}
      <CustomSearchSelect
        value={isRelativeValue ? (conditionValue ?? "") : ""}
        onChange={(value: string) => onChange(value)}
        options={relativeDateOptions}
        optionsClassName="w-40"
        maxHeight="2xl"
        placement="bottom-start"
        disabled={isDisabled}
        customButtonClassName="flex h-full items-center gap-1 px-2 text-secondary hover:bg-layer-2-hover"
        customButton={
          <span className="flex items-center gap-1" title="选择相对日期">
            <CalendarDays className="size-3.5" aria-hidden="true" />
          </span>
        }
      />
    </div>
  );
});
