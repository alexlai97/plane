/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import React from "react";
import { observer } from "mobx-react";
import { useParams } from "next/navigation";
// plane imports
import type { IssuesModalProps } from "./modal";
// local imports
import { CreateUpdateIssueModalBase } from "./base";
import { IssueModalProvider } from "./provider";

export const IssueModalContent = observer(function IssueModalContent(props: IssuesModalProps) {
  // router params
  const { cycleId, moduleId } = useParams();
  // derived values
  const dataForPreload = {
    ...props.data,
    cycle_id: props.data?.cycle_id ? props.data?.cycle_id : cycleId ? cycleId.toString() : null,
    module_ids: props.data?.module_ids ? props.data?.module_ids : moduleId ? [moduleId.toString()] : null,
  };

  if (!props.isOpen) return null;
  return (
    <IssueModalProvider
      templateId={props.templateId}
      dataForPreload={dataForPreload}
      allowedProjectIds={props.allowedProjectIds}
    >
      <CreateUpdateIssueModalBase {...props} />
    </IssueModalProvider>
  );
});
