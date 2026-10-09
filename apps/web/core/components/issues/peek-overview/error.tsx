/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { ArrowLeft, X } from "lucide-react";
import { Tooltip } from "@plane/propel/tooltip";
// assets
import emptyIssue from "@/app/assets/empty-state/issue.svg?url";
// components
import { EmptyState } from "@/components/common/empty-state";
// hooks
import { usePlatformOS } from "@/hooks/use-platform-os";

type TIssuePeekOverviewError = {
  removeRoutePeekId: () => void;
  onBack?: () => void;
};

export function IssuePeekOverviewError(props: TIssuePeekOverviewError) {
  const { removeRoutePeekId, onBack } = props;
  // hooks
  const { isMobile } = usePlatformOS();

  return (
    <div className="relative flex h-full w-full flex-col overflow-hidden">
      <div className="flex flex-shrink-0 justify-start">
        {onBack && (
          <button
            type="button"
            aria-label="返回上一工作项"
            onClick={onBack}
            className="flex items-center gap-1 px-2 text-13 text-secondary"
          >
            <ArrowLeft className="size-4" /> 返回
          </button>
        )}
        <Tooltip tooltipContent="关闭工作项" isMobile={isMobile}>
          <button type="button" aria-label="关闭工作项" onClick={removeRoutePeekId} className="m-5 h-5 w-5">
            <X className="h-4 w-4 text-tertiary hover:text-secondary" />
          </button>
        </Tooltip>
      </div>

      <div className="h-full w-full">
        <EmptyState
          image={emptyIssue ?? undefined}
          title="无法打开工作项"
          description="该工作项可能已删除、已归档，或你没有访问权限。可以返回上一工作项或关闭此窗口。"
        />
      </div>
    </div>
  );
}
