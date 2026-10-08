/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

export function LogoSpinner() {
  return (
    <div role="status" aria-label="正在加载" className="flex items-center justify-center">
      <span className="border-accent-primary h-7 w-7 animate-spin rounded-full border-2 border-t-transparent" />
    </div>
  );
}
