import { observer } from "mobx-react";
import { useGanttDisplay, type GanttDisplayKey } from "@/hooks/use-gantt-display";

const fields: [GanttDisplayKey, string][] = [
  ["assignee", "负责人"],
  ["priority", "优先级"],
  ["modules", "模块"],
  ["legend", "状态颜色图例"],
];
export const GanttDisplayOptions = observer(function GanttDisplayOptions({
  moduleDisabled = false,
}: {
  moduleDisabled?: boolean;
}) {
  const { display, toggle } = useGanttDisplay();
  return (
    <div className="py-2">
      <div className="mb-2 text-13 font-medium text-primary">甘特图显示</div>
      <div className="flex flex-wrap gap-2">
        {fields
          .filter(([key]) => key !== "modules" || !moduleDisabled)
          .map(([key, label]) => (
            <button
              key={key}
              type="button"
              aria-pressed={display[key]}
              onClick={() => toggle(key)}
              className={`rounded-sm border px-2 py-0.5 text-11 ${display[key] ? "border-accent-strong bg-accent-primary text-on-color" : "border-subtle text-secondary hover:bg-layer-1"}`}
            >
              {label}
            </button>
          ))}
      </div>
    </div>
  );
});
