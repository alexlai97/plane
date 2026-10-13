/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

//
import { Fragment } from "react";
import type { IBlockUpdateDependencyData, IGanttIssueGroup } from "@plane/types";
import { GanttChartBlock } from "@/components/gantt-chart/blocks/block";
import { BLOCK_HEIGHT } from "@/components/gantt-chart/constants";

export type GanttChartBlocksProps = {
  blockIds: string[];
  groups?: IGanttIssueGroup[];
  blockToRender: (data: any) => React.ReactNode;
  enableBlockLeftResize: boolean | ((blockId: string) => boolean);
  enableBlockRightResize: boolean | ((blockId: string) => boolean);
  enableBlockMove: boolean | ((blockId: string) => boolean);
  ganttContainerRef: React.RefObject<HTMLDivElement>;
  showAllBlocks: boolean;
  updateBlockDates?: (updates: IBlockUpdateDependencyData[]) => Promise<void>;
  enableDependency: boolean | ((blockId: string) => boolean);
};

export function GanttChartBlocksList(props: GanttChartBlocksProps) {
  const {
    blockIds,
    groups,
    blockToRender,
    enableBlockLeftResize,
    enableBlockRightResize,
    enableBlockMove,
    ganttContainerRef,
    showAllBlocks,
    updateBlockDates,
    enableDependency,
  } = props;

  return (
    <>
      {groups?.length
        ? groups.map((group) => (
            <Fragment key={`group-${group.id}`}>
              <div className="border-b border-subtle bg-layer-1/70" style={{ height: `${BLOCK_HEIGHT}px` }} />
              {group.issueIds.map((blockId) => (
                <GanttChartBlock
                  key={`${group.id}-${blockId}`}
                  blockId={blockId}
                  groupId={group.id}
                  showAllBlocks={showAllBlocks}
                  blockToRender={blockToRender}
                  enableBlockLeftResize={
                    typeof enableBlockLeftResize === "function" ? enableBlockLeftResize(blockId) : enableBlockLeftResize
                  }
                  enableBlockRightResize={
                    typeof enableBlockRightResize === "function"
                      ? enableBlockRightResize(blockId)
                      : enableBlockRightResize
                  }
                  enableBlockMove={typeof enableBlockMove === "function" ? enableBlockMove(blockId) : enableBlockMove}
                  enableDependency={
                    typeof enableDependency === "function" ? enableDependency(blockId) : enableDependency
                  }
                  ganttContainerRef={ganttContainerRef}
                  updateBlockDates={updateBlockDates}
                />
              ))}
            </Fragment>
          ))
        : blockIds?.map((blockId) => (
            <GanttChartBlock
              key={blockId}
              blockId={blockId}
              showAllBlocks={showAllBlocks}
              blockToRender={blockToRender}
              enableBlockLeftResize={
                typeof enableBlockLeftResize === "function" ? enableBlockLeftResize(blockId) : enableBlockLeftResize
              }
              enableBlockRightResize={
                typeof enableBlockRightResize === "function" ? enableBlockRightResize(blockId) : enableBlockRightResize
              }
              enableBlockMove={typeof enableBlockMove === "function" ? enableBlockMove(blockId) : enableBlockMove}
              enableDependency={typeof enableDependency === "function" ? enableDependency(blockId) : enableDependency}
              ganttContainerRef={ganttContainerRef}
              updateBlockDates={updateBlockDates}
            />
          ))}
    </>
  );
}
