/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { lazy, Suspense } from "react";
import type { EIssuesStoreType, TIssue } from "@plane/types";
import { EModalPosition, EModalWidth, ModalCore } from "@plane/ui";
import { Button } from "@plane/propel/button";
import { LogoSpinner } from "@/components/common/logo-spinner";

const IssueModalContent = lazy(() => import("./content").then((module) => ({ default: module.IssueModalContent })));

export interface IssuesModalProps {
  data?: Partial<TIssue>;
  isOpen: boolean;
  onClose: () => void;
  beforeFormSubmit?: () => Promise<void>;
  onSubmit?: (res: TIssue) => Promise<void>;
  withDraftIssueWrapper?: boolean;
  storeType?: EIssuesStoreType;
  isDraft?: boolean;
  fetchIssueDetails?: boolean;
  moveToIssue?: boolean;
  modalTitle?: string;
  primaryButtonText?: {
    default: string;
    loading: string;
  };
  isProjectSelectionDisabled?: boolean;
  templateId?: string;
  allowedProjectIds?: string[];
  showActionItemsOnUpdate?: boolean;
}

// Keep the public entrypoint light for sidebar and global shortcut callers.
// The original form/provider lifecycle starts only when the modal is open.
export function CreateUpdateIssueModal(props: IssuesModalProps) {
  if (!props.isOpen) return null;
  return (
    <Suspense
      fallback={
        <ModalCore isOpen handleClose={props.onClose} position={EModalPosition.TOP} width={EModalWidth.XXXXL}>
          <div role="status" className="flex items-center justify-center gap-3 p-8">
            <LogoSpinner />
            <span>正在加载工作项编辑器…</span>
            <Button variant="secondary" onClick={props.onClose}>
              取消
            </Button>
          </div>
        </ModalCore>
      }
    >
      <IssueModalContent {...props} />
    </Suspense>
  );
}
