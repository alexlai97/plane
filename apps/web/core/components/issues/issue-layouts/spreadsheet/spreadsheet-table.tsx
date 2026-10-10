/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import type { MutableRefObject } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { observer } from "mobx-react";
import { useParams } from "next/navigation";
// plane imports
import type { IIssueDisplayFilterOptions, IIssueDisplayProperties, TIssue } from "@plane/types";
// components
import { SpreadsheetIssueRowLoader } from "@/components/ui/loader/layouts/spreadsheet-layout-loader";
// hooks
import { useIntersectionObserver } from "@/hooks/use-intersection-observer";
import { useIssuesStore } from "@/hooks/use-issue-layout-store";
import type { TSelectionHelper } from "@/hooks/use-multiple-select";
import { useTableKeyboardNavigation } from "@/hooks/use-table-keyboard-navigation";
// local imports
import type { TRenderQuickActions } from "../list/list-view-types";
import { getDisplayPropertiesCount } from "../utils";
import { SpreadsheetIssueRow } from "./issue-row";
import { SpreadsheetHeader } from "./spreadsheet-header";
import { SpreadsheetHierarchyContext } from "./hierarchy-context";

type Props = {
  displayProperties: IIssueDisplayProperties;
  displayFilters: IIssueDisplayFilterOptions;
  handleDisplayFilterUpdate: (data: Partial<IIssueDisplayFilterOptions>) => void;
  issueIds: string[];
  isEstimateEnabled: boolean;
  quickActions: TRenderQuickActions;
  updateIssue: ((projectId: string | null, issueId: string, data: Partial<TIssue>) => Promise<void>) | undefined;
  canEditProperties: (projectId: string | undefined) => boolean;
  portalElement: React.MutableRefObject<HTMLDivElement | null>;
  containerRef: MutableRefObject<HTMLTableElement | null>;
  canLoadMoreIssues: boolean;
  loadMoreIssues: () => void;
  spreadsheetColumnsList: (keyof IIssueDisplayProperties)[];
  selectionHelpers: TSelectionHelper;
  isEpic?: boolean;
};

export const SpreadsheetTable = observer(function SpreadsheetTable(props: Props) {
  const {
    displayProperties,
    displayFilters,
    handleDisplayFilterUpdate,
    issueIds,
    isEstimateEnabled,
    portalElement,
    quickActions,
    updateIssue,
    canEditProperties,
    canLoadMoreIssues,
    containerRef,
    loadMoreIssues,
    spreadsheetColumnsList,
    selectionHelpers,
    isEpic = false,
  } = props;

  // states
  const isScrolled = useRef(false);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const onExpansionChange = useCallback((id: string, expanded: boolean) => {
    setExpandedIds((current) => {
      if (current.has(id) === expanded) return current;
      const next = new Set(current);
      if (expanded) next.add(id);
      else next.delete(id);
      return next;
    });
  }, []);
  const [expansion, setExpansion] = useState({ expanded: false, revision: 0 });
  const [intersectionElement, setIntersectionElement] = useState<HTMLTableSectionElement | null>(null);

  const {
    issues: { getIssueLoader },
    issuesFilter,
  } = useIssuesStore();

  const routeKey = JSON.stringify(useParams());
  const filterKey = JSON.stringify(issuesFilter.appliedFilters ?? {});
  useEffect(() => {
    setExpandedIds(new Set());
    setExpansion((value) => ({ expanded: false, revision: value.revision + 1 }));
  }, [filterKey, routeKey]);

  const handleScroll = useCallback(() => {
    if (!containerRef.current) return;
    const scrollLeft = containerRef.current.scrollLeft;

    const columnShadow = "8px 22px 22px 10px rgba(0, 0, 0, 0.05)"; // shadow for regular columns
    const headerShadow = "8px -22px 22px 10px rgba(0, 0, 0, 0.05)"; // shadow for headers

    //The shadow styles are added this way to avoid re-render of all the rows of table, which could be costly
    if (scrollLeft > 0 !== isScrolled.current) {
      const firstColumns = containerRef.current.querySelectorAll("table tr td:first-child, th:first-child");

      for (let i = 0; i < firstColumns.length; i++) {
        const shadow = i === 0 ? headerShadow : columnShadow;
        if (scrollLeft > 0) {
          (firstColumns[i] as HTMLElement).style.boxShadow = shadow;
        } else {
          (firstColumns[i] as HTMLElement).style.boxShadow = "none";
        }
      }
      isScrolled.current = scrollLeft > 0;
    }
  }, [containerRef]);

  useEffect(() => {
    const currentContainerRef = containerRef.current;

    if (currentContainerRef) currentContainerRef.addEventListener("scroll", handleScroll);

    return () => {
      if (currentContainerRef) currentContainerRef.removeEventListener("scroll", handleScroll);
    };
  }, [handleScroll, containerRef]);

  const isPaginating = !!getIssueLoader();

  useIntersectionObserver(containerRef, isPaginating ? null : intersectionElement, loadMoreIssues, `100% 0% 100% 0%`);

  const handleKeyBoardNavigation = useTableKeyboardNavigation();

  const ignoreFieldsForCounting: (keyof IIssueDisplayProperties)[] = ["key"];
  if (!isEstimateEnabled) ignoreFieldsForCounting.push("estimate");
  const displayPropertiesCount = getDisplayPropertiesCount(displayProperties, ignoreFieldsForCounting);

  const hierarchy = useMemo(
    () => ({ ...expansion, rootIds: new Set(issueIds), onExpansionChange }),
    [expansion, issueIds, onExpansionChange]
  );
  return (
    <SpreadsheetHierarchyContext.Provider value={hierarchy}>
      <table className="w-full overflow-y-auto bg-surface-1" onKeyDown={handleKeyBoardNavigation}>
        <SpreadsheetHeader
          expanded={expandedIds.size > 0}
          onToggleExpand={() =>
            setExpansion((value) => ({ expanded: expandedIds.size === 0, revision: value.revision + 1 }))
          }
          displayProperties={displayProperties}
          displayFilters={displayFilters}
          handleDisplayFilterUpdate={handleDisplayFilterUpdate}
          canEditProperties={canEditProperties}
          isEstimateEnabled={isEstimateEnabled}
          spreadsheetColumnsList={spreadsheetColumnsList}
          selectionHelpers={selectionHelpers}
          isEpic={isEpic}
        />
        <tbody>
          {issueIds.map((id) => (
            <SpreadsheetIssueRow
              key={id}
              issueId={id}
              displayProperties={displayProperties}
              quickActions={quickActions}
              canEditProperties={canEditProperties}
              nestingLevel={0}
              isEstimateEnabled={isEstimateEnabled}
              updateIssue={updateIssue}
              portalElement={portalElement}
              containerRef={containerRef}
              isScrolled={isScrolled}
              spreadsheetColumnsList={spreadsheetColumnsList}
              selectionHelpers={selectionHelpers}
              isEpic={isEpic}
            />
          ))}
        </tbody>
        {canLoadMoreIssues && (
          <tfoot ref={setIntersectionElement}>
            {["first", "second", "third"].map((key) => (
              <SpreadsheetIssueRowLoader key={key} columnCount={displayPropertiesCount} />
            ))}
          </tfoot>
        )}
      </table>
    </SpreadsheetHierarchyContext.Provider>
  );
});
