/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

export const BLOCK_HEIGHT = 44;

export const HEADER_HEIGHT = 48;

export const GANTT_BREADCRUMBS_HEIGHT = 40;

export const SIDEBAR_WIDTH = 360;

export const DEFAULT_BLOCK_WIDTH = 60;

export const GANTT_SELECT_GROUP = "gantt-issues";

const getGroupedElementId = (prefix: string, blockId: string, groupId?: string) =>
  groupId ? `${prefix}-${blockId}-group-${encodeURIComponent(groupId)}` : `${prefix}-${blockId}`;

export const getGanttBlockElementId = (blockId: string, groupId?: string) =>
  getGroupedElementId("gantt-block", blockId, groupId);

export const getGanttSidebarElementId = (blockId: string, groupId?: string) =>
  getGroupedElementId("draggable", blockId, groupId);
