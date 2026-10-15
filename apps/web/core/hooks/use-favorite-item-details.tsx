/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

// plane imports
import type { MouseEvent } from "react";
import type { IFavorite } from "@plane/types";
// components
import { getPageName } from "@plane/utils";
import {
  FavoriteItemIcon,
  generateFavoriteItemLink,
} from "@/components/workspace/sidebar/favorites/favorite-items/common";
// helpers
// hooks
import { useCycle } from "@/hooks/store/use-cycle";
import { useModule } from "@/hooks/store/use-module";
import { useProject } from "@/hooks/store/use-project";
import { useProjectView } from "@/hooks/store/use-project-view";
import { useGlobalView } from "@/hooks/store/use-global-view";
import { useIssueDetail } from "@/hooks/store/use-issue-detail";
import { useIssues } from "@/hooks/store/use-issues";
// plane web hooks
import { EPageStoreType, usePage } from "@/hooks/store";
import { useAdditionalFavoriteItemDetails } from "@/hooks/use-additional-favorite-item-details";

export const useFavoriteItemDetails = (workspaceSlug: string, favorite: IFavorite) => {
  const { entity_identifier: favoriteItemId, entity_data, entity_type: favoriteItemEntityType } = favorite;
  const favoriteItemLogoProps = entity_data?.logo_props;
  const favoriteItemName = entity_data?.name || favorite?.name;
  // store hooks
  const { getViewById } = useProjectView();
  const { getProjectById } = useProject();
  const { getViewDetailsById } = useGlobalView();
  const { setPeekIssue } = useIssueDetail();
  const { issueMap } = useIssues();
  const { getCycleById } = useCycle();
  const { getModuleById } = useModule();
  // additional details
  const { getAdditionalFavoriteItemDetails } = useAdditionalFavoriteItemDetails();
  // derived values
  const pageDetail = usePage({
    pageId: favoriteItemId ?? "",
    storeType: EPageStoreType.PROJECT,
  });
  const viewDetails = getViewById(favoriteItemId ?? "");
  const cycleDetail = getCycleById(favoriteItemId ?? "");
  const moduleDetail = getModuleById(favoriteItemId ?? "");
  const currentProjectDetails = getProjectById(favorite.project_id ?? "");

  let itemIcon;
  let itemTitle;
  const isUnavailable = favorite.is_available === false || favorite.entity_data === null;
  const itemLink = isUnavailable ? undefined : generateFavoriteItemLink(workspaceSlug.toString(), favorite);
  let onClick: ((event: MouseEvent<HTMLAnchorElement>) => void) | undefined;

  switch (favoriteItemEntityType) {
    case "project":
      itemTitle = currentProjectDetails?.name ?? favoriteItemName;
      itemIcon = <FavoriteItemIcon type="project" logo={currentProjectDetails?.logo_props || favoriteItemLogoProps} />;
      break;
    case "page":
      itemTitle = getPageName(pageDetail?.name ?? favoriteItemName);
      itemIcon = <FavoriteItemIcon type="page" logo={pageDetail?.logo_props ?? favoriteItemLogoProps} />;
      break;
    case "view":
      itemTitle = viewDetails?.name ?? favoriteItemName;
      itemIcon = <FavoriteItemIcon type="view" logo={viewDetails?.logo_props || favoriteItemLogoProps} />;
      break;
    case "cycle":
      itemTitle = cycleDetail?.name ?? favoriteItemName;
      itemIcon = <FavoriteItemIcon type="cycle" />;
      break;
    case "module":
      itemTitle = moduleDetail?.name ?? favoriteItemName;
      itemIcon = <FavoriteItemIcon type="module" />;
      break;
    case "issue": {
      const issue = favoriteItemId ? issueMap[favoriteItemId] : undefined;
      const projectId = favorite.project_id ?? favorite.entity_data?.project_id ?? issue?.project_id;
      const project = projectId ? getProjectById(projectId) : undefined;
      const projectIdentifier = favorite.entity_data?.project_identifier ?? project?.identifier;
      const sequenceId = favorite.entity_data?.sequence_id ?? issue?.sequence_id;
      const identifier =
        projectIdentifier && sequenceId !== undefined && sequenceId !== null
          ? `${projectIdentifier}-${sequenceId}`
          : favorite.entity_data?.identifier;
      itemTitle = `${identifier ? `${identifier} ` : ""}${issue?.name ?? favorite.entity_data?.name ?? ""}`.trim();
      itemIcon = <FavoriteItemIcon type="issue" />;
      onClick = (event) => {
        if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || !projectId)
          return;
        event.preventDefault();
        setPeekIssue({ workspaceSlug, projectId, issueId: favoriteItemId ?? "" });
      };
      break;
    }
    case "artifact":
      itemTitle = favorite.entity_data?.name ?? "";
      itemIcon = <FavoriteItemIcon type="artifact" />;
      break;
    case "workspace_view": {
      const view = favoriteItemId ? getViewDetailsById(favoriteItemId) : undefined;
      itemTitle = view?.name ?? favorite.entity_data?.name ?? "";
      itemIcon = <FavoriteItemIcon type="workspace_view" />;
      break;
    }
    default: {
      const additionalDetails = getAdditionalFavoriteItemDetails(workspaceSlug, favorite);
      itemTitle = additionalDetails.itemTitle;
      itemIcon = additionalDetails.itemIcon;
      break;
    }
  }

  if (isUnavailable) {
    itemTitle = "内容不可用";
    itemIcon = <FavoriteItemIcon type={favorite.entity_type} />;
  }

  return { itemIcon, itemTitle, itemLink, onClick, isUnavailable };
};
