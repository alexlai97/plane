export function notificationReturnPath(workspaceSlug: string, saved: string | null) {
  const home = `/${workspaceSlug}/`;
  if (!saved?.startsWith(home) || saved.includes("\\") || /[\r\n]/.test(saved)) return home;
  const path = saved.split(/[?#]/)[0];
  if (path === `${home}notifications` || path.startsWith(`${home}notifications/`)) return home;
  return saved;
}
