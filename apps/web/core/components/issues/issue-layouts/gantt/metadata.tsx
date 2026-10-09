import { observer } from "mobx-react";
import type { TIssue } from "@plane/types";
import { useMember } from "@/hooks/store/use-member";
import { useModule } from "@/hooks/store/use-module";
import { useGanttDisplay } from "@/hooks/use-gantt-display";

export const GanttMetadata = observer(function GanttMetadata({
  issue,
  preview = false,
}: {
  issue: Pick<TIssue, "assignee_ids" | "priority" | "module_ids">;
  preview?: boolean;
}) {
  const { getUserDetails } = useMember();
  const { getModuleById } = useModule();
  const { display } = useGanttDisplay();
  const names = (issue.assignee_ids ?? []).map((id) => getUserDetails(id)?.display_name || "成员");
  const fullNames = names.join("、") || "未分配";
  const shortNames = names.slice(0, 2).join("、") + (names.length > 2 ? ` +${names.length - 2}` : "");
  const modules = (issue.module_ids ?? []).map((id) => getModuleById(id)?.name || "模块").join("、") || "无模块";
  const priority = ({ urgent: "紧急", high: "高", medium: "中", low: "低", none: "无" } as Record<string, string>)[
    issue.priority ?? "none"
  ];
  return (
    <div className="flex min-w-0 items-center gap-2 text-11 text-secondary" data-gantt-metadata>
      {(preview || display.assignee) && (
        <span className="min-w-0 truncate" title={`负责人：${fullNames}`}>
          {preview ? `负责人：${fullNames}` : shortNames || "未分配"}
        </span>
      )}
      {!preview && display.priority && (
        <span className="shrink-0" title="优先级">
          {priority}
        </span>
      )}
      {!preview && display.modules && (
        <span className="min-w-0 truncate" title={`模块：${modules}`}>
          {modules}
        </span>
      )}
    </div>
  );
});
