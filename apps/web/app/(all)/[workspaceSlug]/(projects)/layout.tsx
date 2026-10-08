/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useEffect } from "react";
import { observer } from "mobx-react";
import { Outlet } from "react-router";
import { useWorkspace } from "@/hooks/store/use-workspace";
import { ProjectsAppPowerKProvider } from "@/components/power-k/projects-app-provider";
// plane web components
import { ProjectAppSidebar } from "./_sidebar";
import { ExtendedProjectSidebar } from "./extended-project-sidebar";

function WorkspaceLayout() {
  const { currentWorkspace } = useWorkspace();
  const isAIStrategy = currentWorkspace?.id === "bb96243d-e9cd-424e-8fb6-6117ae54f621";
  // Header and portal menus are outside this layout's DOM subtree.
  // Apply the same scoped palette there, and release it when leaving the workspace.
  useEffect(() => {
    if (!isAIStrategy) return;
    document.body.dataset.bokangTheme = "blue-gray";
    return () => {
      delete document.body.dataset.bokangTheme;
    };
  }, [isAIStrategy]);
  return (
    <>
      <ProjectsAppPowerKProvider />
      <div
        className="relative flex h-full w-full flex-col overflow-hidden rounded-lg border border-subtle"
        data-bokang-theme={isAIStrategy ? "blue-gray" : undefined}
      >
        <div id="full-screen-portal" className="absolute inset-0 w-full" />
        <div className="relative flex size-full overflow-hidden">
          <ProjectAppSidebar />
          <ExtendedProjectSidebar />
          <main className="relative flex h-full w-full flex-col overflow-hidden bg-surface-1">
            <Outlet />
          </main>
        </div>
      </div>
    </>
  );
}

export default observer(WorkspaceLayout);
