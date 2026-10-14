import type { IWorkspace } from "@plane/types";

type TWorkspaceAppearance = NonNullable<IWorkspace["appearance"]>;

/** Narrow potentially stale or older-server workspace data to supported appearance settings. */
export function getWorkspaceAppearance(value: unknown): TWorkspaceAppearance {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const appearance = value as Record<string, unknown>;
  const result: TWorkspaceAppearance = {};
  if (appearance.theme === "blue-gray" || appearance.theme === "" || appearance.theme === null) {
    result.theme = appearance.theme;
  }
  if (appearance.organization_logo_url === null) {
    result.organization_logo_url = null;
  } else if (typeof appearance.organization_logo_url === "string") {
    const url = appearance.organization_logo_url;
    if (
      !url.startsWith("//") &&
      !url.includes("\\") &&
      !/[\u0000-\u001f\u007f]/.test(url) &&
      (!url || url.startsWith("/") || /^https?:\/\//i.test(url))
    ) {
      result.organization_logo_url = url;
    }
  }
  return result;
}
