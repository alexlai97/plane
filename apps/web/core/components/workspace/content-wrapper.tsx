/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import React from "react";
import { observer } from "mobx-react";
// plane imports
import { cn } from "@plane/utils";
import { AppRailRoot } from "@/components/navigation";
import { useAppRailVisibility } from "@/lib/app-rail";
import { TopNavigationRoot } from "@/components/navigation/top-navigation-root";
import { useWorkspaceAccessPolicy } from "@/components/workspace/access-policy-context";

export const WorkspaceContentWrapper = observer(function WorkspaceContentWrapper({
  children,
}: {
  children: React.ReactNode;
}) {
  // Use the context to determine if app rail should render
  const { shouldRenderAppRail } = useAppRailVisibility();
  const { policy } = useWorkspaceAccessPolicy();
  const showAppRail = shouldRenderAppRail && policy?.profile === "standard";

  return (
    <div className="relative flex size-full flex-col overflow-hidden bg-canvas transition-all duration-300 ease-in-out">
      <TopNavigationRoot />
      <div className="relative flex size-full overflow-hidden">
        {/* Conditionally render AppRailRoot based on context */}
        {showAppRail && <AppRailRoot />}
        <div
          className={cn(
            "relative size-full flex-grow overflow-hidden pr-2 pb-2 pl-2 transition-all duration-300 ease-in-out",
            {
              "pl-0!": showAppRail,
            }
          )}
        >
          {children}
        </div>
      </div>
    </div>
  );
});
