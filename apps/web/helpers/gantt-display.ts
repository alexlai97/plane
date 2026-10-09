export const GANTT_DISPLAY_DEFAULTS = { assignee: true, priority: false, modules: false, legend: true };
export type GanttDisplayKey = keyof typeof GANTT_DISPLAY_DEFAULTS;
export function parseGanttDisplay(raw: string) {
  const display = { ...GANTT_DISPLAY_DEFAULTS };
  try {
    const saved = JSON.parse(raw);
    for (const field of Object.keys(display) as GanttDisplayKey[]) {
      if (typeof saved?.[field] === "boolean") display[field] = saved[field];
    }
  } catch {
    /* Retain defaults for malformed browser preferences. */
  }
  return display;
}
