/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useEffect } from "react";

type PageHeadTitleProps = {
  title?: string;
  description?: string;
};

export function PageHead(props: PageHeadTitleProps) {
  const { title } = props;

  useEffect(() => {
    if (title) {
      document.title = title.replace(/Plane/g, "泊康项目管理系统").includes("泊康项目管理系统")
        ? title.replace(/Plane/g, "泊康项目管理系统")
        : title + " · 泊康项目管理系统";
    }
  }, [title]);

  return null;
}
