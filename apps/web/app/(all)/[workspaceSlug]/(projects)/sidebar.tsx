/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { isEmpty } from "lodash-es";
import { observer } from "mobx-react";
// plane helpers
import { EUserPermissions, EUserPermissionsLevel } from "@plane/constants";
// components
import { SidebarWrapper } from "@/components/sidebar/sidebar-wrapper";
import { SidebarFavoritesMenu } from "@/components/workspace/sidebar/favorites/favorites-menu";
import { SidebarProjectsList } from "@/components/workspace/sidebar/projects-list";
import { SidebarQuickActions } from "@/components/workspace/sidebar/quick-actions";
import { SidebarMenuItems } from "@/components/workspace/sidebar/sidebar-menu-items";
// hooks
import { useWorkspace } from "@/hooks/store/use-workspace";
import { useFavorite } from "@/hooks/store/use-favorite";
import { useUserPermissions } from "@/hooks/store/user";

export const AppSidebar = observer(function AppSidebar() {
  const { currentWorkspace } = useWorkspace();
  const isAIStrategy = currentWorkspace?.id === "bb96243d-e9cd-424e-8fb6-6117ae54f621";
  // store hooks
  const { allowPermissions } = useUserPermissions();
  const { groupedFavorites } = useFavorite();

  // derived values
  const canPerformWorkspaceMemberActions = allowPermissions(
    [EUserPermissions.ADMIN, EUserPermissions.MEMBER],
    EUserPermissionsLevel.WORKSPACE
  );

  const isFavoriteEmpty = isEmpty(groupedFavorites);

  return (
    <SidebarWrapper
      title="Projects"
      brand={
        isAIStrategy ? (
          <div className="bokang-department-brand">
            <span className="bokang-department-mark" aria-hidden="true">
              BK
            </span>
            <div className="min-w-0">
              <div className="truncate text-16 font-semibold text-primary">AI战略部</div>
              <div className="text-11 text-tertiary">项目与工作协作</div>
            </div>
          </div>
        ) : undefined
      }
      quickActions={<SidebarQuickActions />}
    >
      <SidebarMenuItems />
      {/* Favorites Menu */}
      {canPerformWorkspaceMemberActions && !isFavoriteEmpty && <SidebarFavoritesMenu />}
      {/* Projects List */}
      <SidebarProjectsList />
    </SidebarWrapper>
  );
});
