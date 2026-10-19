import { observer } from "mobx-react";
import { Avatar, AvatarGroup } from "@plane/ui";
import { getFileURL } from "@plane/utils";
import { ButtonAvatars } from "@/components/dropdowns/member/avatar";
import { useMember } from "@/hooks/store/use-member";
import { resolveArtifactAssignees } from "../../helpers/gallery";
import type { ArtifactAssignee } from "../../helpers/gallery";

/** Business responsibility only; creation owner and file uploaders are not assignees. */
export const ArtifactAssignees = observer(function ArtifactAssignees({
  ids = [],
  resolvedMembers,
  showNames = false,
}: {
  ids?: string[];
  resolvedMembers?: ArtifactAssignee[];
  showNames?: boolean;
}) {
  const { getUserDetails } = useMember();
  const unique = [...new Set(ids)];
  const resolved = resolveArtifactAssignees(unique, resolvedMembers);
  const names = resolved
    ? unique.map((id) => resolved.find((member) => member.id === id)?.display_name || "成员信息暂不可用").join("、")
    : unique.map((id) => getUserDetails(id)?.display_name || "成员信息暂不可用").join("、");
  return (
    <span
      data-artifact-assignees
      aria-label={`负责人：${names || "未设置"}`}
      title={`负责人：${names || "未设置"}`}
      className="inline-flex min-w-0 shrink-0 items-center gap-1.5 text-12 text-secondary"
    >
      {resolved ? (
        <AvatarGroup size="md" showTooltip={false}>
          {resolved.map((member) => (
            <Avatar key={member.id} src={getFileURL(member.avatar_url ?? "")} name={member.display_name} />
          ))}
        </AvatarGroup>
      ) : (
        <ButtonAvatars userIds={unique} size="md" showTooltip={false} />
      )}
      {(showNames || !unique.length) && <span className="truncate">{names || "未设置"}</span>}
    </span>
  );
});
