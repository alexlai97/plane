/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useEffect } from "react";
import { observer } from "mobx-react";
import { Outlet } from "react-router";
import { useWorkspace } from "@/hooks/store/use-workspace";
import { getWorkspaceAppearance } from "../../../../core/helpers/workspace-appearance";
import { ProjectsAppPowerKProvider } from "@/components/power-k/projects-app-provider";
// plane web components
import { ProjectAppSidebar } from "./_sidebar";
import { ExtendedProjectSidebar } from "./extended-project-sidebar";

function WorkspaceLayout() {
  const { currentWorkspace } = useWorkspace();
  const appearance = getWorkspaceAppearance(currentWorkspace?.appearance);
  const theme = appearance.theme || undefined;
  // Header and portal menus are outside this layout's DOM subtree.
  // Apply the same scoped palette there, and release it when leaving the workspace.
  useEffect(() => {
    if (!theme) return;
    document.body.dataset.bokangTheme = theme;
    return () => {
      delete document.body.dataset.bokangTheme;
    };
  }, [theme]);
  return (
    <>
      <ProjectsAppPowerKProvider />
      <div
        className="relative flex h-full w-full flex-col overflow-hidden rounded-lg border border-subtle"
        data-bokang-theme={theme}
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
