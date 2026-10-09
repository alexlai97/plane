/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { observer } from "mobx-react";
// plane imports
import { useTranslation } from "@plane/i18n";
import { cn, getFileURL } from "@plane/utils";

type Props = {
  workspaceId?: string;
  logo: string | null | undefined;
  name: string | undefined;
  classNames?: string;
};

export const WorkspaceLogo = observer(function WorkspaceLogo(props: Props) {
  // translation
  const { t } = useTranslation();

  const departmentLogo = props.workspaceId === "bb96243d-e9cd-424e-8fb6-6117ae54f621" ? "/ai-strategy-icon.png" : null;
  const logo = departmentLogo ?? (props.logo ? getFileURL(props.logo) : null);

  return (
    <div
      className={cn(
        `relative grid h-6 w-6 flex-shrink-0 place-items-center uppercase ${
          !logo && "rounded-md bg-accent-primary text-on-color"
        } ${props.classNames ? props.classNames : ""}`
      )}
    >
      {logo ? (
        <img
          src={logo}
          className="absolute top-0 left-0 h-full w-full rounded-md object-cover"
          alt={t("aria_labels.projects_sidebar.workspace_logo")}
        />
      ) : (
        (props.name?.[0] ?? "...")
      )}
    </div>
  );
});
