/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import type { ISvgIcons } from "../type";
export function PlaneLogo({ width = "40", height = "40", className, color = "currentColor" }: ISvgIcons) {
  return (
    <svg
      width={width}
      height={height}
      viewBox="0 0 64 64"
      className={className}
      xmlns="http://www.w3.org/2000/svg"
      aria-label="泊康"
    >
      <rect width="64" height="64" rx="14" fill={color} />
      <text x="32" y="41" textAnchor="middle" fontSize="26" fontFamily="sans-serif" fontWeight="700" fill="white">
        BK
      </text>
    </svg>
  );
}
