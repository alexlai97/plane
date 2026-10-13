/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useCallback, useMemo, useState } from "react";
import { isEqual, cloneDeep, merge } from "lodash-es";
import { observer } from "mobx-react";
// plane imports
import { DEFAULT_GLOBAL_VIEWS_LIST, EUserPermissionsLevel } from "@plane/constants";
import { setToast, TOAST_TYPE } from "@plane/propel/toast";
import type { IWorkspaceView, TWorkItemFilterExpression } from "@plane/types";
import { EUserProjectRoles, EViewAccess } from "@plane/types";
import { getComputedDisplayFilters, getComputedDisplayProperties } from "@plane/utils";
// components
import { CreateUpdateWorkspaceViewModal } from "@/components/workspace/views/modal";
// hooks
import { useGlobalView } from "@/hooks/store/use-global-view";
import { useLabel } from "@/hooks/store/use-label";
import { useMember } from "@/hooks/store/use-member";
import { useProject } from "@/hooks/store/use-project";
import { useUser, useUserPermissions } from "@/hooks/store/user";
// local imports
import { WorkItemFiltersHOC } from "./base";
import { mergeSavedDisplayFilters } from "./merge-display-filters";
import type { TEnableSaveViewProps, TEnableUpdateViewProps, TSharedWorkItemFiltersHOCProps } from "./shared";

type TWorkspaceLevelWorkItemFiltersHOCProps = TSharedWorkItemFiltersHOCProps & {
  workspaceSlug: string;
} & TEnableSaveViewProps &
  TEnableUpdateViewProps;

export const WorkspaceLevelWorkItemFiltersHOC = observer(function WorkspaceLevelWorkItemFiltersHOC(
  props: TWorkspaceLevelWorkItemFiltersHOCProps
) {
  const { children, enableSaveView, enableUpdateView, entityId, initialWorkItemFilters, workspaceSlug } = props;
  // states
  const [isCreateViewModalOpen, setIsCreateViewModalOpen] = useState(false);
  const [createViewPayload, setCreateViewPayload] = useState<Partial<IWorkspaceView> | undefined>(undefined);
  // hooks
  const { getViewDetailsById, updateGlobalView } = useGlobalView();
  const { data: currentUser } = useUser();
  const { allowPermissions } = useUserPermissions();
  const { joinedProjectIds } = useProject();
  const {
    workspace: { getWorkspaceMemberIds },
  } = useMember();
  const { getWorkspaceLabelIds } = useLabel();
  // derived values
  const hasWorkspaceMemberLevelPermissions = allowPermissions(
    [EUserProjectRoles.ADMIN, EUserProjectRoles.MEMBER],
    EUserPermissionsLevel.WORKSPACE,
    workspaceSlug
  );
  const viewDetails = entityId ? getViewDetailsById(entityId) : null;
  const isDefaultView = typeof entityId === "string" && DEFAULT_GLOBAL_VIEWS_LIST.some((view) => view.key === entityId);
  const isViewLocked = viewDetails ? viewDetails?.is_locked : false;
  const isCurrentUserOwner = viewDetails ? viewDetails.owned_by === currentUser?.id : false;
  const canCreateView = useMemo(
    () => enableSaveView && !props.saveViewOptions?.isDisabled && hasWorkspaceMemberLevelPermissions,
    [enableSaveView, props.saveViewOptions?.isDisabled, hasWorkspaceMemberLevelPermissions]
  );
  const canUpdateView = useMemo(
    () =>
      enableUpdateView &&
      !isDefaultView &&
      !props.updateViewOptions?.isDisabled &&
      !isViewLocked &&
      hasWorkspaceMemberLevelPermissions &&
      isCurrentUserOwner,
    [
      enableUpdateView,
      props.updateViewOptions?.isDisabled,
      isDefaultView,
      isViewLocked,
      hasWorkspaceMemberLevelPermissions,
      isCurrentUserOwner,
    ]
  );
  const createViewLabel = useMemo(
    () => (props.saveViewOptions?.label === "Save as" ? "另存为视图" : props.saveViewOptions?.label),
    [props.saveViewOptions?.label]
  );
  const updateViewLabel = useMemo(
    () =>
      props.updateViewOptions?.label ?? (viewDetails?.access === EViewAccess.PUBLIC ? "更新共享视图" : "更新个人视图"),
    [props.updateViewOptions?.label, viewDetails?.access]
  );
  const hasAdditionalChanges =
    !isEqual(
      getComputedDisplayFilters(initialWorkItemFilters?.displayFilters),
      getComputedDisplayFilters(viewDetails?.display_filters)
    ) ||
    !isEqual(
      getComputedDisplayProperties(initialWorkItemFilters?.displayProperties),
      getComputedDisplayProperties(viewDetails?.display_properties)
    );

  const getDefaultViewDetailPayload: () => Partial<IWorkspaceView> = useCallback(
    () => ({
      name: viewDetails ? `${viewDetails?.name} 2` : "Untitled",
      description: viewDetails ? viewDetails.description : "",
      access: viewDetails ? viewDetails.access : EViewAccess.PUBLIC,
    }),
    [viewDetails]
  );

  const getViewFilterPayload: (filterExpression: TWorkItemFilterExpression) => Partial<IWorkspaceView> = useCallback(
    (filterExpression: TWorkItemFilterExpression) => ({
      rich_filters: cloneDeep(filterExpression),
      display_filters: mergeSavedDisplayFilters(viewDetails?.display_filters, initialWorkItemFilters?.displayFilters),
      display_properties: merge({}, viewDetails?.display_properties, initialWorkItemFilters?.displayProperties),
    }),
    [initialWorkItemFilters, viewDetails]
  );

  const handleViewSave = useCallback(
    (expression: TWorkItemFilterExpression) => {
      setCreateViewPayload({
        ...getDefaultViewDetailPayload(),
        ...getViewFilterPayload(expression),
      });
      setIsCreateViewModalOpen(true);
    },
    [getDefaultViewDetailPayload, getViewFilterPayload]
  );

  const handleViewUpdate = useCallback(
    (filterExpression: TWorkItemFilterExpression) => {
      if (!viewDetails) {
        setToast({
          type: TOAST_TYPE.ERROR,
          title: "视图不存在",
          message: "未找到要更新的视图。",
        });

        return;
      }

      updateGlobalView(
        workspaceSlug,
        viewDetails.id,
        {
          ...getViewFilterPayload(filterExpression),
        },
        /* No need to sync filters here as updateFilters already handles it */
        false
      )
        .then(() => {
          setToast({
            type: TOAST_TYPE.SUCCESS,
            title: "视图已更新",
            message: "视图内容已成功保存。",
          });
        })
        .catch(() => {
          setToast({
            type: TOAST_TYPE.ERROR,
            title: "视图更新失败",
            message: "视图未保存，请检查筛选规则或权限后重试。",
          });
        });
    },
    [viewDetails, updateGlobalView, workspaceSlug, getViewFilterPayload]
  );

  const saveViewOptions = useMemo(
    () => ({
      label: createViewLabel,
      isDisabled: !canCreateView,
      onViewSave: handleViewSave,
    }),
    [createViewLabel, canCreateView, handleViewSave]
  );

  const updateViewOptions = useMemo(
    () => ({
      label: updateViewLabel,
      isDisabled: !canUpdateView,
      hasAdditionalChanges,
      onViewUpdate: handleViewUpdate,
    }),
    [updateViewLabel, canUpdateView, hasAdditionalChanges, handleViewUpdate]
  );

  return (
    <>
      <CreateUpdateWorkspaceViewModal
        preLoadedData={createViewPayload}
        isOpen={isCreateViewModalOpen}
        onClose={() => {
          setCreateViewPayload(undefined);
          setIsCreateViewModalOpen(false);
        }}
      />
      <WorkItemFiltersHOC
        {...props}
        memberIds={getWorkspaceMemberIds(workspaceSlug)}
        labelIds={getWorkspaceLabelIds(workspaceSlug)}
        projectIds={joinedProjectIds}
        saveViewOptions={saveViewOptions}
        updateViewOptions={updateViewOptions}
      >
        {children}
      </WorkItemFiltersHOC>
    </>
  );
});
