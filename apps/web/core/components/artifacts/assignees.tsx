import { observer } from "mobx-react";
import { ButtonAvatars } from "@/components/dropdowns/member/avatar";
import { useMember } from "@/hooks/store/use-member";

/** Business responsibility only; creation owner and file uploaders are not assignees. */
export const ArtifactAssignees = observer(function ArtifactAssignees({
  ids = [],
  showNames = false,
}: {
  ids?: string[];
  showNames?: boolean;
}) {
  const { getUserDetails } = useMember();
  const unique = [...new Set(ids)];
  const names = unique.map((id) => getUserDetails(id)?.display_name || "成员信息暂不可用").join("、");
  return (
    <span
      data-artifact-assignees
      aria-label={`负责人：${names || "未设置"}`}
      title={`负责人：${names || "未设置"}`}
      className="inline-flex min-w-0 shrink-0 items-center gap-1.5 text-12 text-secondary"
    >
      <ButtonAvatars userIds={unique} size="md" showTooltip={false} />
      {(showNames || !unique.length) && <span className="truncate">{names || "未设置"}</span>}
    </span>
  );
});
