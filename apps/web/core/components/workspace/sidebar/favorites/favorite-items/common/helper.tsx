/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { FAVORITE_ITEM_LINKS } from "@plane/constants";
import type { IFavorite } from "@plane/types";

export const generateFavoriteItemLink = (workspaceSlug: string, favorite: IFavorite) => {
  const entityLinkDetails = FAVORITE_ITEM_LINKS[favorite.entity_type];

  if (!entityLinkDetails) {
    return undefined;
  }

  if (!favorite.entity_identifier) return undefined;

  if (entityLinkDetails.itemLevel === "workspace") {
    return `/${workspaceSlug}/${entityLinkDetails.getLink(favorite)}`;
  } else if (entityLinkDetails.itemLevel === "project") {
    if (!favorite.project_id) return undefined;
    return `/${workspaceSlug}/projects/${favorite.project_id}/${entityLinkDetails.getLink(favorite)}`;
  } else {
    return undefined;
  }
};
