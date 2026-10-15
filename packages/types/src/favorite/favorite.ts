/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import type { TLogoProps } from "../common";

export type TFavoriteEntityType =
  | "project"
  | "cycle"
  | "module"
  | "view"
  | "page"
  | "issue"
  | "artifact"
  | "workspace_view"
  | "folder"
  | (string & {});

export type IFavoriteEntityData = {
  id?: string;
  name: string;
  logo_props?: TLogoProps;
  /** Additional live metadata used by entity-specific favorite actions. */
  project_id?: string | null;
  sequence_id?: number | null;
  project_identifier?: string | null;
  identifier?: string | null;
  [key: string]: unknown;
};

export type IFavorite = {
  id: string;
  name: string;
  entity_type: TFavoriteEntityType;
  /** Null means the entity is unavailable to the current user. */
  entity_data: IFavoriteEntityData | null;
  /** Older favorite payloads omit this; new entity types always set it. */
  is_available?: boolean;
  is_folder: boolean;
  sort_order: number;
  parent: string | null;
  entity_identifier?: string | null;
  children: IFavorite[];
  project_id: string | null;
  sequence: number;
  workspace_id: string;
};
