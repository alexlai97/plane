/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */
import { EModalWidth, ModalCore } from "@plane/ui";
import { Button } from "@plane/propel/button";
export type PaidPlanUpgradeModalProps = { isOpen: boolean; handleClose: () => void };
export function PaidPlanUpgradeModal({ isOpen, handleClose }: PaidPlanUpgradeModalProps) {
  return (
    <ModalCore isOpen={isOpen} handleClose={handleClose} width={EModalWidth.MD}>
      <div className="space-y-4 p-6">
        <h2 className="text-lg font-semibold text-primary">功能暂未开放</h2>
        <p className="text-13 text-secondary">当前部署暂未开放此功能。如有业务需要，请联系系统管理员。</p>
        <Button onClick={handleClose}>知道了</Button>
      </div>
    </ModalCore>
  );
}
