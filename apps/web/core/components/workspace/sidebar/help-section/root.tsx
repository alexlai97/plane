/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { HelpCircle } from "lucide-react";
import { CustomMenu } from "@plane/ui";
import { AppSidebarItem } from "@/components/sidebar/sidebar-item";
import { usePowerK } from "@/hooks/store/use-power-k";
export function HelpMenuRoot() {
  const { toggleShortcutsListModal } = usePowerK();
  return (
    <CustomMenu
      customButton={
        <AppSidebarItem variant="button" item={{ icon: <HelpCircle className="size-5" />, isActive: false }} />
      }
      closeOnSelect
    >
      <CustomMenu.MenuItem onClick={() => window.open("/bokang-help.html", "_blank", "noopener,noreferrer")}>
        使用帮助
      </CustomMenu.MenuItem>
      <CustomMenu.MenuItem onClick={() => toggleShortcutsListModal(true)}>键盘快捷键</CustomMenu.MenuItem>
      <CustomMenu.MenuItem onClick={() => window.open("/open-source.html", "_blank", "noopener,noreferrer")}>
        开源说明与源码
      </CustomMenu.MenuItem>
    </CustomMenu>
  );
}
