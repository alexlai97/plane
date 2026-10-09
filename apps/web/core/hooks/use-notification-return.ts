import { useRouter } from "next/navigation";
import { notificationReturnPath } from "@/helpers/notification-return";
export function useNotificationReturn(workspaceSlug: string) {
  const router = useRouter();
  const key = `bokang:notification-return:${workspaceSlug}`;
  return {
    open: () => {
      try {
        sessionStorage.setItem(key, location.pathname + location.search + location.hash);
      } catch {
        /* Use home fallback. */
      }
      router.push(`/${workspaceSlug}/notifications/`);
    },
    close: () => {
      let saved: string | null = null;
      try {
        saved = sessionStorage.getItem(key);
        sessionStorage.removeItem(key);
      } catch {
        /* Use home fallback. */
      }
      router.replace(notificationReturnPath(workspaceSlug, saved));
    },
  };
}
