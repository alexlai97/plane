/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

// components
import type { IBlockUpdateData, IGanttBlock } from "@plane/types";
import { Fragment } from "react";
import type { IGanttIssueGroup } from "@plane/types";
import RenderIfVisible from "@/components/core/render-if-visible-HOC";
// hooks
import { BlockRow } from "@/components/gantt-chart/blocks/block-row";
import { BLOCK_HEIGHT } from "@/components/gantt-chart/constants";
import type { TSelectionHelper } from "@/hooks/use-multiple-select";
// types

export type GanttChartBlocksProps = {
  blockIds: string[];
  groups?: IGanttIssueGroup[];
  blockUpdateHandler: (block: any, payload: IBlockUpdateData) => void;
  handleScrollToBlock: (block: IGanttBlock) => void;
  enableAddBlock: boolean | ((blockId: string) => boolean);
  showAllBlocks: boolean;
  selectionHelpers: TSelectionHelper;
  ganttContainerRef: React.RefObject<HTMLDivElement>;
};

export function GanttChartRowList(props: GanttChartBlocksProps) {
  const {
    blockIds,
    groups,
    blockUpdateHandler,
    handleScrollToBlock,
    enableAddBlock,
    showAllBlocks,
    selectionHelpers,
    ganttContainerRef,
  } = props;

  return (
    <div className="absolute top-0 left-0 w-max min-w-full">
      {groups?.length
        ? groups.map((group) => (
            <Fragment key={`group-${group.id}`}>
              <div
                className="relative min-w-full border-b border-subtle bg-layer-1/70"
                style={{ height: `${BLOCK_HEIGHT}px` }}
              />
              {group.issueIds.map((blockId) => (
                <RenderIfVisible
                  key={`${group.id}-${blockId}`}
                  root={ganttContainerRef}
                  horizontalOffset={100}
                  verticalOffset={200}
                  classNames="relative min-w-full w-max"
                  placeholderChildren={
                    <div className="pointer-events-none w-full" style={{ height: `${BLOCK_HEIGHT}px` }} />
                  }
                  shouldRecordHeights={false}
                >
                  <BlockRow
                    blockId={blockId}
                    groupId={group.id}
                    showAllBlocks={showAllBlocks}
                    blockUpdateHandler={blockUpdateHandler}
                    handleScrollToBlock={handleScrollToBlock}
                    enableAddBlock={typeof enableAddBlock === "function" ? enableAddBlock(blockId) : enableAddBlock}
                    selectionHelpers={selectionHelpers}
                    ganttContainerRef={ganttContainerRef}
                  />
                </RenderIfVisible>
              ))}
            </Fragment>
          ))
        : blockIds?.map((blockId) => (
            <>
              <RenderIfVisible
                root={ganttContainerRef}
                horizontalOffset={100}
                verticalOffset={200}
                classNames="relative min-w-full w-max"
                placeholderChildren={
                  <div className="pointer-events-none w-full" style={{ height: `${BLOCK_HEIGHT}px` }} />
                }
                shouldRecordHeights={false}
              >
                <BlockRow
                  key={blockId}
                  blockId={blockId}
                  showAllBlocks={showAllBlocks}
                  blockUpdateHandler={blockUpdateHandler}
                  handleScrollToBlock={handleScrollToBlock}
                  enableAddBlock={typeof enableAddBlock === "function" ? enableAddBlock(blockId) : enableAddBlock}
                  selectionHelpers={selectionHelpers}
                  ganttContainerRef={ganttContainerRef}
                />
              </RenderIfVisible>
            </>
          ))}
    </div>
  );
}
