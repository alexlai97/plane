import { useSyncExternalStore } from "react";
import { useUser } from "@/hooks/store/user";

import { parseGanttDisplay, type GanttDisplayKey } from "@/helpers/gantt-display";
export type { GanttDisplayKey } from "@/helpers/gantt-display";
const fallback = new Map<string, string>();
const eventName = "bokang-gantt-display";
function subscribe(listener: () => void) {
  window.addEventListener(eventName, listener);
  window.addEventListener("storage", listener);
  return () => {
    window.removeEventListener(eventName, listener);
    window.removeEventListener("storage", listener);
  };
}

export function useGanttDisplay() {
  const { data: user } = useUser();
  const key = `bokang:gantt-display:v1:${user?.id ?? "anonymous"}:${typeof window === "undefined" ? "" : window.location.pathname}`;
  const raw = useSyncExternalStore(
    subscribe,
    () => {
      try {
        return localStorage.getItem(key) ?? "{}";
      } catch {
        return fallback.get(key) ?? "{}";
      }
    },
    () => "{}"
  );
  const display = parseGanttDisplay(raw);
  const toggle = (field: GanttDisplayKey) => {
    const next = JSON.stringify({ ...display, [field]: !display[field] });
    try {
      localStorage.setItem(key, next);
    } catch {
      fallback.set(key, next);
    }
    window.dispatchEvent(new Event(eventName));
  };
  return { display, toggle };
}
