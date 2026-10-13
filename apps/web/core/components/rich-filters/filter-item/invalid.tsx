/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import React from "react";
import { observer } from "mobx-react";
import { CircleAlert } from "lucide-react";
// plane imports
import type { TExternalFilter, TFilterProperty } from "@plane/types";
// local imports
import { FilterItemCloseButton } from "./close-button";
import { FilterItemContainer } from "./container";
import { FilterItemProperty } from "./property";
import type { IFilterItemProps } from "./root";

export const InvalidFilterItem = observer(function InvalidFilterItem<
  P extends TFilterProperty,
  E extends TExternalFilter,
>(props: IFilterItemProps<P, E>) {
  const { condition, filter, isDisabled = false, showTransition = true } = props;

  return (
    <FilterItemContainer
      conditionValue={condition.value}
      showTransition={showTransition}
      variant="error"
      tooltipContent="这个筛选条件暂不支持编辑。请核对后选择保留或移除；不支持的规则可能无法保存。"
    >
      {/* Property section */}
      <FilterItemProperty
        conditionId={condition.id}
        icon={CircleAlert}
        label={`未识别：${String(condition.property)}`}
        filter={filter}
        isDisabled={isDisabled}
      />
      {/* Remove button */}
      {!isDisabled && <FilterItemCloseButton conditionId={condition.id} filter={filter} />}
    </FilterItemContainer>
  );
});
