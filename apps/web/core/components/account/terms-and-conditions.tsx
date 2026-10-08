/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { EAuthModes } from "@plane/constants";
export function TermsAndConditions(_props: { authType?: EAuthModes }) {
  return <p className="text-center text-13 text-tertiary">内部协作系统 · 账号开通与密码恢复请联系管理员</p>;
}
