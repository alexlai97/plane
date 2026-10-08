/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import type { ReactNode } from "react";
import { PageHead } from "@/components/core/page-title";
import { EAuthModes } from "@/helpers/authentication.helper";
export function AuthHeader(_props: { type: EAuthModes }) {
  return <AuthHeaderBase pageTitle="登录" />;
}
export function AuthHeaderBase({ pageTitle }: { pageTitle: string; additionalAction?: ReactNode }) {
  return (
    <>
      <PageHead title={pageTitle + " · 泊康项目管理系统"} />
      <div className="flex items-center gap-3">
        <img src="/bokang-icon.svg" alt="泊康" className="h-9 w-9" />
        <span className="text-lg font-semibold text-primary">泊康项目管理系统</span>
      </div>
    </>
  );
}
