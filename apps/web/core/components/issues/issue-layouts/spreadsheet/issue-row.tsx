/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import type { Dispatch, MouseEvent, MutableRefObject, SetStateAction } from "react";
import { useEffect, useRef, useState } from "react";
import useSWR from "swr";
import { observer } from "mobx-react";
import { useParams } from "next/navigation";
import { MoreHorizontal } from "lucide-react";
import { SPREADSHEET_SELECT_GROUP } from "@plane/constants";
// plane helpers
import { useOutsideClickDetector } from "@plane/hooks";
import { ChevronRightIcon } from "@plane/propel/icons";
// types
import { Tooltip } from "@plane/propel/tooltip";
import type { IIssueDisplayProperties, TIssue } from "@plane/types";
import { EIssueServiceType } from "@plane/types";
// ui
import { ControlLink, Row } from "@plane/ui";
import { setToast, TOAST_TYPE } from "@plane/propel/toast";
import { cn, generateWorkItemLink } from "@plane/utils";
// components
import { MultipleSelectEntityAction } from "@/components/core/multiple-select";
import RenderIfVisible from "@/components/core/render-if-visible-HOC";
import { IssueIdentifier } from "@/components/issues/issue-detail/issue-identifier";
// hooks
import { useIssueDetail } from "@/hooks/store/use-issue-detail";
import { useIssues } from "@/hooks/store/use-issues";
import { useProject } from "@/hooks/store/use-project";
import useIssuePeekOverviewRedirection from "@/hooks/use-issue-peek-overview-redirection";
import type { TSelectionHelper } from "@/hooks/use-multiple-select";
import { usePlatformOS } from "@/hooks/use-platform-os";
// local components
import type { TRenderQuickActions } from "../list/list-view-types";
import { isIssueNew } from "../utils";
import { IssueColumn } from "./issue-column";
import { loadHierarchyPath } from "./hierarchy-path";
import { useSpreadsheetHierarchy } from "./hierarchy-context";
import { useIssuesStore } from "@/hooks/use-issue-layout-store";
import { IssueService } from "@/services/issue/issue.service";

interface Props {
  displayProperties: IIssueDisplayProperties;
  isEstimateEnabled: boolean;
  quickActions: TRenderQuickActions;
  canEditProperties: (projectId: string | undefined) => boolean;
  updateIssue: ((projectId: string | null, issueId: string, data: Partial<TIssue>) => Promise<void>) | undefined;
  portalElement: React.MutableRefObject<HTMLDivElement | null>;
  nestingLevel: number;
  issueId: string;
  isScrolled: MutableRefObject<boolean>;
  containerRef: MutableRefObject<HTMLTableElement | null>;
  spreadsheetColumnsList: (keyof IIssueDisplayProperties)[];
  spacingLeft?: number;
  selectionHelpers: TSelectionHelper;
  shouldRenderByDefault?: boolean;
  isEpic?: boolean;
}

export const SpreadsheetIssueRow = observer(function SpreadsheetIssueRow(props: Props) {
  const {
    displayProperties,
    issueId,
    isEstimateEnabled,
    nestingLevel,
    portalElement,
    updateIssue,
    quickActions,
    canEditProperties,
    isScrolled,
    containerRef,
    spreadsheetColumnsList,
    spacingLeft = 6,
    selectionHelpers,
    shouldRenderByDefault,
    isEpic = false,
  } = props;
  // states
  const [isExpanded, setExpanded] = useState<boolean>(false);
  // store hooks
  const detailStore = useIssueDetail(isEpic ? EIssueServiceType.EPICS : EIssueServiceType.ISSUES);
  const { subIssues: subIssuesStore } = detailStore;
  const issueStore = useIssues();
  const { issueMap } = issueStore;

  // derived values
  const issue = issueMap[issueId];
  const hierarchy = useSpreadsheetHierarchy();
  const { onExpansionChange } = hierarchy;
  const { issuesFilter } = useIssuesStore();
  const { workspaceSlug, moduleId, cycleId } = useParams();
  const queryKey = JSON.stringify(issuesFilter.appliedFilters ?? {});
  const cachedIds = subIssuesStore.subIssuesByIssueId(issueId) ?? [];
  const [filteredChildren, setFilteredChildren] = useState<string[]>([]);
  const [loadedQuery, setLoadedQuery] = useState<string>();
  // Observe edits to loaded children. Revalidate through the canonical server filter.
  const observedChildren = useRef(new Set<string>());
  for (const id of [...cachedIds, ...filteredChildren]) observedChildren.current.add(id);
  const childRevision = JSON.stringify([...observedChildren.current].map((id) => issueMap[id]));
  useEffect(() => {
    onExpansionChange(issueId, isExpanded && !!issue?.sub_issues_count);
    return () => onExpansionChange(issueId, false);
  }, [onExpansionChange, issueId, isExpanded, issue?.sub_issues_count]);
  useEffect(() => {
    setExpanded(hierarchy.expanded);
  }, [hierarchy.revision, hierarchy.expanded]);
  useEffect(() => {
    let active = true;
    if (!isExpanded || !workspaceSlug || !issue?.project_id || isEpic || !issue.sub_issues_count) return;
    const service = new IssueService();
    const load = async () => {
      const query = {
        ...JSON.parse(queryKey),
        parent: issueId,
        sub_issue: true,
        group_by: undefined,
        sub_group_by: undefined,
        ...(moduleId ? { module: String(moduleId) } : {}),
        ...(cycleId ? { cycle: String(cycleId) } : {}),
        per_page: 100,
      };
      let cursor: string | undefined;
      const children: TIssue[] = [];
      do {
        // oxlint-disable-next-line no-await-in-loop -- Each cursor depends on the previous response.
        const response = await service.getIssuesFromServer(String(workspaceSlug), issue.project_id!, {
          ...query,
          cursor,
        });
        if (!active) return;
        children.push(...(response.results as TIssue[]));
        cursor = response.next_page_results ? response.next_cursor : undefined;
      } while (cursor);
      if (!active) return;
      // Keep the unfiltered detail cache intact; only this table owns the filtered IDs.
      detailStore.rootIssueStore.issues.addIssue(children);
      setFilteredChildren([...new Set(children.map((child) => child.id))]);
      setLoadedQuery(queryKey);
    };
    void load().catch(() => {
      if (active) {
        setFilteredChildren([]);
        setExpanded(false);
        setToast({ type: TOAST_TYPE.ERROR, title: "子工作项加载失败", message: "请再次展开重试。" });
      }
    });
    return () => {
      active = false;
    };
  }, [
    isExpanded,
    queryKey,
    issueId,
    workspaceSlug,
    moduleId,
    cycleId,
    childRevision,
    isEpic,
    issue?.project_id,
    issue?.sub_issues_count,
    detailStore.rootIssueStore.issues,
  ]);
  const subIssues = loadedQuery === queryKey ? filteredChildren.filter((id) => !hierarchy.rootIds.has(id)) : [];
  const isIssueSelected = selectionHelpers.getIsEntitySelected(issueId);
  const isIssueActive = selectionHelpers.getIsEntityActive(issueId);

  if (!issue) return null;

  return (
    <>
      {/* first column/ issue name and key column */}
      <RenderIfVisible
        as="tr"
        root={containerRef}
        placeholderChildren={
          <td
            colSpan={100}
            className="border-[0.5px] border-transparent border-b-subtle-1"
            style={{ height: "calc(2.75rem - 1px)" }}
          />
        }
        classNames={cn("bg-surface-1 transition-[background-color]", {
          "group selected-issue-row": isIssueSelected,
          "border-[0.5px] border-strong-1": isIssueActive,
        })}
        verticalOffset={100}
        shouldRecordHeights={false}
        defaultValue={shouldRenderByDefault || isIssueNew(issue)}
      >
        <IssueRowDetails
          issueId={issueId}
          displayProperties={displayProperties}
          quickActions={quickActions}
          canEditProperties={canEditProperties}
          nestingLevel={nestingLevel}
          spacingLeft={spacingLeft}
          isEstimateEnabled={isEstimateEnabled}
          updateIssue={updateIssue}
          portalElement={portalElement}
          isScrolled={isScrolled}
          isExpanded={isExpanded}
          setExpanded={setExpanded}
          spreadsheetColumnsList={spreadsheetColumnsList}
          selectionHelpers={selectionHelpers}
          isEpic={isEpic}
        />
      </RenderIfVisible>

      {isExpanded &&
        !isEpic &&
        subIssues?.map((subIssueId: string) => (
          <SpreadsheetIssueRow
            key={subIssueId}
            issueId={subIssueId}
            displayProperties={displayProperties}
            quickActions={quickActions}
            canEditProperties={canEditProperties}
            nestingLevel={nestingLevel + 1}
            spacingLeft={spacingLeft + 28}
            isEstimateEnabled={isEstimateEnabled}
            updateIssue={updateIssue}
            portalElement={portalElement}
            isScrolled={isScrolled}
            containerRef={containerRef}
            spreadsheetColumnsList={spreadsheetColumnsList}
            selectionHelpers={selectionHelpers}
            shouldRenderByDefault={isExpanded}
          />
        ))}
    </>
  );
});

interface IssueRowDetailsProps {
  displayProperties: IIssueDisplayProperties;
  isEstimateEnabled: boolean;
  quickActions: TRenderQuickActions;
  canEditProperties: (projectId: string | undefined) => boolean;
  updateIssue: ((projectId: string | null, issueId: string, data: Partial<TIssue>) => Promise<void>) | undefined;
  portalElement: React.MutableRefObject<HTMLDivElement | null>;
  nestingLevel: number;
  issueId: string;
  isScrolled: MutableRefObject<boolean>;
  isExpanded: boolean;
  setExpanded: Dispatch<SetStateAction<boolean>>;
  spreadsheetColumnsList: (keyof IIssueDisplayProperties)[];
  spacingLeft?: number;
  selectionHelpers: TSelectionHelper;
  isEpic?: boolean;
}

const IssueRowDetails = observer(function IssueRowDetails(props: IssueRowDetailsProps) {
  const {
    displayProperties,
    issueId,
    isEstimateEnabled,
    nestingLevel,
    portalElement,
    updateIssue,
    quickActions,
    canEditProperties,
    isScrolled,
    isExpanded,
    setExpanded,
    spreadsheetColumnsList,
    spacingLeft = 6,
    selectionHelpers,
    isEpic = false,
  } = props;
  // states
  const [isMenuActive, setIsMenuActive] = useState(false);
  // refs
  const cellRef = useRef(null);
  const menuActionRef = useRef<HTMLButtonElement | null>(null);
  // router
  const { workspaceSlug, projectId } = useParams();
  // hooks
  const { getProjectIdentifierById } = useProject();
  const { getIsIssuePeeked, peekIssue } = useIssueDetail(isEpic ? EIssueServiceType.EPICS : EIssueServiceType.ISSUES);
  const { handleRedirection } = useIssuePeekOverviewRedirection(isEpic);
  const { isMobile } = usePlatformOS();

  // handlers
  const handleIssuePeekOverview = (issue: TIssue) =>
    handleRedirection(workspaceSlug?.toString(), issue, isMobile, nestingLevel);

  const { subIssues: subIssuesStore, issue } = useIssueDetail();

  const issueDetail = issue.getIssueById(issueId);

  const parentId = nestingLevel === 0 ? issueDetail?.parent_id : null;
  const { data: parentPath, error: parentPathError } = useSWR(
    parentId && workspaceSlug && issueDetail?.project_id
      ? ["spreadsheet-parent-path", workspaceSlug, issueDetail.project_id, parentId]
      : null,
    ([, slug, project, parent]) =>
      loadHierarchyPath(parent, (id) => new IssueService().retrieve(String(slug), project, id)),
    { revalidateOnFocus: false }
  );
  const contextPath = parentPath?.map((parent) => parent.name).join(" / ");
  const subIssueIndentation = `${spacingLeft}px`;

  useOutsideClickDetector(menuActionRef, () => setIsMenuActive(false));

  const customActionButton = (
    <button
      type="button"
      aria-label="工作项操作"
      ref={menuActionRef}
      className={`flex h-full w-full cursor-pointer items-center rounded-sm p-1 text-placeholder hover:bg-layer-1 ${
        isMenuActive ? "bg-layer-1 text-primary" : "text-secondary"
      }`}
      onClick={() => setIsMenuActive(!isMenuActive)}
    >
      <MoreHorizontal className="h-3.5 w-3.5" />
    </button>
  );
  if (!issueDetail) return null;

  const handleToggleExpand = (e: MouseEvent<HTMLButtonElement>) => {
    e.stopPropagation();
    e.preventDefault();
    if (nestingLevel >= 3) {
      handleIssuePeekOverview(issueDetail);
    } else {
      setExpanded((prevState) => {
        if (!prevState && workspaceSlug && issueDetail && issueDetail.project_id)
          subIssuesStore.fetchSubIssues(workspaceSlug.toString(), issueDetail.project_id, issueDetail.id);
        return !prevState;
      });
    }
  };

  const disableUserActions = !canEditProperties(issueDetail.project_id ?? undefined);
  const subIssuesCount = issueDetail?.sub_issues_count ?? 0;
  const isIssueSelected = selectionHelpers.getIsEntitySelected(issueDetail.id);
  const projectIdentifier = getProjectIdentifierById(issueDetail.project_id);

  const canSelectIssues = !disableUserActions && !selectionHelpers.isSelectionDisabled;

  const workItemLink = generateWorkItemLink({
    workspaceSlug: workspaceSlug?.toString(),
    projectId: issueDetail?.project_id,
    issueId,
    projectIdentifier,
    sequenceId: issueDetail?.sequence_id,
    isEpic,
  });

  return (
    <>
      {/* Single sticky column containing both identifier and workitem */}
      <td
        id={`issue-${issueId}`}
        ref={cellRef}
        tabIndex={0}
        className="group/list-block relative left-0 z-10 max-w-lg bg-surface-1 md:sticky"
      >
        <ControlLink
          href={workItemLink}
          onClick={() => handleIssuePeekOverview(issueDetail)}
          className="outline-none"
          disabled={!!issueDetail?.tempId}
        >
          <Row
            className={cn(
              "group clickable z-10 flex min-h-11 w-full cursor-pointer items-center border-r-[0.5px] border-subtle-1 bg-transparent text-13 group-[.selected-issue-row]:bg-accent-primary/5 after:absolute group-[.selected-issue-row]:hover:bg-accent-primary/10",
              {
                "border-b-[0.5px]": !getIsIssuePeeked(issueDetail.id),
                "border border-accent-strong hover:border-accent-strong":
                  getIsIssuePeeked(issueDetail.id) && nestingLevel === peekIssue?.nestingLevel,
                "shadow-[8px_22px_22px_10px_rgba(0,0,0,0.05)]": isScrolled.current,
              }
            )}
          >
            {nestingLevel > 0 && (
              <div
                className="shrink-0 self-stretch border-r border-subtle-1"
                style={{ width: subIssueIndentation }}
                aria-hidden="true"
              />
            )}
            {/* Identifier section - conditionally rendered */}
            {displayProperties?.key && (
              <div className="flex h-full min-w-24 flex-shrink-0 items-center">
                <div className="relative flex cursor-pointer items-center text-11 hover:text-primary">
                  {issueDetail.project_id && (
                    <IssueIdentifier
                      issueId={issueDetail.id}
                      projectId={issueDetail.project_id}
                      size="xs"
                      variant="tertiary"
                      displayProperties={displayProperties}
                    />
                  )}
                </div>
              </div>
            )}

            {/* Workitem section */}
            <div
              className={cn("flex flex-grow items-center gap-0.5 py-2", {
                "min-w-[360px]": !displayProperties?.key,
                "min-w-60": displayProperties?.key,
              })}
            >
              {/* select checkbox */}
              {projectId && canSelectIssues && (
                <Tooltip
                  tooltipContent={
                    <>
                      Only work items within the current
                      <br />
                      project can be selected.
                    </>
                  }
                  disabled={issueDetail.project_id === projectId}
                >
                  <div className="absolute left-1 mr-1 grid w-3.5 flex-shrink-0 place-items-center">
                    <MultipleSelectEntityAction
                      className={cn(
                        "pointer-events-none opacity-0 transition-opacity group-hover/list-block:pointer-events-auto group-hover/list-block:opacity-100",
                        {
                          "pointer-events-auto opacity-100": isIssueSelected,
                        }
                      )}
                      groupId={SPREADSHEET_SELECT_GROUP}
                      id={issueDetail.id}
                      selectionHelpers={selectionHelpers}
                      disabled={issueDetail.project_id !== projectId}
                    />
                  </div>
                </Tooltip>
              )}

              {/* sub-issues chevron */}
              <div className="grid size-4 place-items-center">
                {subIssuesCount > 0 && !isEpic && (
                  <button
                    type="button"
                    className="grid size-4 place-items-center rounded-xs text-placeholder hover:text-tertiary"
                    aria-label={isExpanded ? "收起子工作项" : "展开子工作项"}
                    aria-expanded={isExpanded}
                    onClick={handleToggleExpand}
                  >
                    <ChevronRightIcon
                      className={cn("size-4", {
                        "rotate-90": isExpanded,
                      })}
                      strokeWidth={2.5}
                    />
                  </button>
                )}
              </div>

              <div className="my-auto flex h-full w-full items-center justify-between gap-2 truncate">
                <div className="w-full min-w-0 text-14 text-primary">
                  {parentId && (
                    <div
                      className="mb-0.5 truncate pr-4 text-11 text-secondary"
                      title={contextPath ? `所属：${contextPath}（上级未纳入本视图）` : undefined}
                    >
                      所属：{contextPath ?? (parentPathError ? "上级工作项暂无法读取" : "正在读取上级…")}
                    </div>
                  )}
                  <div className="w-full overflow-hidden">
                    <Tooltip tooltipContent={issueDetail.name} isMobile={isMobile}>
                      <div
                        className="h-full w-full cursor-pointer truncate pr-4 text-left text-13 text-primary focus:outline-none"
                        tabIndex={-1}
                      >
                        {issueDetail.name}
                      </div>
                    </Tooltip>
                  </div>
                </div>
                <div
                  role="presentation"
                  className={`opacity-0 transition-opacity group-hover:opacity-100 ${isMenuActive ? "!opacity-100" : ""}`}
                  onClick={(e) => e.stopPropagation()}
                >
                  {quickActions({
                    issue: issueDetail,
                    parentRef: cellRef,
                    customActionButton,
                    portalElement: portalElement.current,
                  })}
                </div>
              </div>
            </div>
          </Row>
        </ControlLink>
      </td>
      {/* Rest of the columns */}
      {spreadsheetColumnsList.map((property) => (
        <IssueColumn
          key={property}
          displayProperties={displayProperties}
          issueDetail={issueDetail}
          disableUserActions={disableUserActions}
          property={property}
          updateIssue={updateIssue}
          isEstimateEnabled={isEstimateEnabled}
        />
      ))}
    </>
  );
});
