import { hasTemplateDescriptionContent as hasContent } from "@/helpers/work-item-template";
import { useEffect, useRef, useState } from "react";
import type { MutableRefObject } from "react";
import { useFormContext } from "react-hook-form";
import type { EditorRefApi } from "@plane/editor";
import type { TIssue } from "@plane/types";
import { RichTextEditor } from "@/components/editor/rich-text";
import { observer } from "mobx-react";
import { useMember } from "@/hooks/store/use-member";
import { useUser } from "@/hooks/store/user/user-user";
import { useWorkspace } from "@/hooks/store/use-workspace";
import { WorkItemTemplateService } from "@/services/work-item-template.service";
import type { WorkItemTemplate } from "@/services/work-item-template.service";

const service = new WorkItemTemplateService();
const button = "rounded border border-subtle px-2 py-1 text-caption-md-regular hover:bg-layer-2 disabled:opacity-50";

export const WorkItemTemplates = observer(function WorkItemTemplates({
  workspaceSlug,
  projectId,
  editorRef,
  eligible,
}: {
  workspaceSlug: string;
  projectId: string | null;
  editorRef: MutableRefObject<EditorRefApi | null>;
  eligible: boolean;
}) {
  const { getValues, setValue } = useFormContext<TIssue>();
  const { getWorkspaceBySlug } = useWorkspace();
  const { data: currentUser } = useUser();
  const { getUserDetails, project: memberStore } = useMember();
  const [editorSession, setEditorSession] = useState(0);
  const startEditing = (value: Partial<WorkItemTemplate>) => {
    setEditorSession((prev) => prev + 1);
    setEditing(value);
  };
  const [templates, setTemplates] = useState<WorkItemTemplate[]>([]);
  const [canManage, setCanManage] = useState(false);
  const [selected, setSelected] = useState("");
  const [manage, setManage] = useState(false);
  const [editing, setEditing] = useState<Partial<WorkItemTemplate> | null>(null);
  const [pending, setPending] = useState<WorkItemTemplate | "empty" | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const templateEditorRef = useRef<EditorRefApi | null>(null);
  const generation = useRef(0);
  const apply = (template: WorkItemTemplate | "empty", append = false) => {
    const html = template === "empty" ? "<p></p>" : template.description_html;
    const value = append ? `${getValues("description_html") ?? ""}<p></p>${html}` : html;
    if (!editorRef.current) {
      setError("编辑器尚未就绪，请稍后选择模板。");
      return;
    }
    editorRef.current.setEditorValue(value);
    setValue("description_html", value, { shouldDirty: true });
    setSelected(template === "empty" ? "" : template.id);
    setPending(null);
    setError("");
  };
  useEffect(() => {
    const current = ++generation.current;
    let active = true;
    let readyTimer: ReturnType<typeof setTimeout> | undefined;
    setTemplates([]);
    setCanManage(false);
    setSelected("");
    setManage(false);
    setEditing(null);
    setPending(null);
    setError("");
    if (!projectId) return;
    void memberStore.fetchProjectMembers(workspaceSlug, projectId).catch(() => undefined);
    service
      .list(workspaceSlug, projectId)
      .then((res) => {
        if (!active || generation.current !== current) return undefined;
        setTemplates(res.results);
        setCanManage(res.can_manage);
        const defaultTemplate = res.results.find((item) => item.is_default);
        if (eligible && defaultTemplate) {
          const applyWhenReady = (attempt = 0) => {
            if (!active || hasContent(getValues("description_html") ?? "")) return;
            if (editorRef.current) apply(defaultTemplate);
            else if (attempt < 20) readyTimer = setTimeout(() => applyWhenReady(attempt + 1), 100);
          };
          applyWhenReady();
        }
        return undefined;
      })
      .catch(() => {
        if (active && generation.current === current) setError("暂时无法加载模板，仍可直接填写任务。");
      });
    return () => {
      active = false;
      if (readyTimer) clearTimeout(readyTimer);
    };
    // Apply the default once per project; never overwrite an existing draft.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceSlug, projectId]);
  const refresh = async () => {
    if (!projectId) return;
    const res = await service.list(workspaceSlug, projectId);
    setTemplates(res.results);
    setCanManage(res.can_manage);
  };
  const mutate = async (operation: () => Promise<unknown>) => {
    setBusy(true);
    setError("");
    try {
      await operation();
      await refresh();
      setEditing(null);
    } catch (err) {
      const response = err as { response?: { status?: number; data?: { error?: string } } };
      setError(
        response.response?.data?.error ??
          (response.response?.status === 409 ? "模板已被修改，请重新打开。" : "保存失败，请检查名称和内容后重试。")
      );
    } finally {
      setBusy(false);
    }
  };
  if (!projectId) return null;
  return (
    <div className="mb-3 space-y-2 text-body-sm-regular">
      <div className="flex items-center gap-2">
        <span>模板</span>
        <select
          aria-label="工作项模板"
          className={`${button} max-w-64`}
          value={selected}
          onChange={(event) => {
            const template = templates.find((item) => item.id === event.target.value) ?? "empty";
            if (hasContent(getValues("description_html") ?? "")) setPending(template);
            else apply(template);
          }}
        >
          <option value="">空白任务</option>
          {templates.map((item) => (
            <option key={item.id} value={item.id}>
              {item.name}
              {item.recommended_member_ids.includes(currentUser?.id ?? "") ? " · 推荐给我" : ""}
              {item.is_default ? "（默认）" : ""}
            </option>
          ))}
        </select>
        {canManage && (
          <button
            type="button"
            className={button}
            onClick={() => {
              setManage(!manage);
              setEditing(null);
            }}
          >
            管理模板
          </button>
        )}
      </div>
      {pending && (
        <div className="flex flex-wrap items-center gap-2 rounded bg-layer-2 p-2">
          <span>描述已有内容，如何应用模板？</span>
          <button type="button" className={button} onClick={() => apply(pending)}>
            替换描述
          </button>
          {pending !== "empty" && (
            <button type="button" className={button} onClick={() => apply(pending, true)}>
              保留并追加
            </button>
          )}
          <button type="button" className={button} onClick={() => setPending(null)}>
            取消
          </button>
        </div>
      )}
      {manage && (
        <div className="space-y-3 rounded border border-subtle bg-layer-1 p-3">
          <p>团队共享模板 · 修改仅影响今后新建的任务；负责人、状态和日期在任务中填写。</p>
          <div className="flex gap-2">
            <button
              type="button"
              className={button}
              disabled={busy}
              onClick={() =>
                startEditing({ name: "", description_html: "<p></p>", recommended_member_ids: [], is_default: false })
              }
            >
              新建模板
            </button>
            <button
              type="button"
              className={button}
              disabled={busy}
              onClick={() =>
                startEditing({
                  name: "",
                  description_html: getValues("description_html") ?? "<p></p>",
                  recommended_member_ids: [],
                  is_default: false,
                })
              }
            >
              将当前描述存为模板
            </button>
          </div>
          {!editing &&
            templates.map((item) => (
              <div key={item.id} className="flex flex-wrap items-center gap-2 border-b border-subtle py-2">
                <span className="mr-auto">
                  {item.name}
                  {item.is_default && " · 默认"}
                </span>
                <button type="button" className={button} disabled={busy} onClick={() => startEditing({ ...item })}>
                  编辑
                </button>
                <button
                  type="button"
                  className={button}
                  disabled={busy}
                  onClick={() =>
                    startEditing({
                      name: `${item.name}（副本）`,
                      description_html: item.description_html,
                      recommended_member_ids: item.recommended_member_ids,
                      is_default: false,
                    })
                  }
                >
                  复制
                </button>
                <button
                  type="button"
                  className={button}
                  disabled={busy}
                  onClick={() =>
                    void mutate(() =>
                      service.save(workspaceSlug, projectId, {
                        id: item.id,
                        version: item.version,
                        is_default: !item.is_default,
                      })
                    )
                  }
                >
                  {item.is_default ? "取消默认" : "设为默认"}
                </button>
                <button
                  type="button"
                  className={button}
                  disabled={busy}
                  onClick={() => {
                    if (window.confirm(`删除模板“${item.name}”？已有任务不会受影响。`))
                      void mutate(() => service.remove(workspaceSlug, projectId, item.id));
                  }}
                >
                  删除
                </button>
              </div>
            ))}
          {editing && (
            <div className="space-y-2">
              <input
                aria-label="模板名称"
                maxLength={100}
                placeholder="模板名称"
                className="w-full rounded border border-subtle bg-surface-1 p-2"
                value={editing.name ?? ""}
                onKeyDown={(event) => {
                  if (event.key === "Enter") event.preventDefault();
                }}
                onChange={(event) => setEditing({ ...editing, name: event.target.value })}
              />
              <div className="max-h-80 overflow-auto rounded border border-subtle bg-surface-1">
                <RichTextEditor
                  key={editorSession}
                  editable
                  id="work-item-template-editor"
                  ref={templateEditorRef}
                  disabledExtensions={["image", "ai", "issue-embed"]}
                  initialValue={editing.description_html ?? ""}
                  workspaceSlug={workspaceSlug}
                  workspaceId={getWorkspaceBySlug(workspaceSlug)?.id ?? ""}
                  projectId={projectId}
                  onChange={(_json: object, html: string) =>
                    setEditing((prev) => (prev ? { ...prev, description_html: html } : prev))
                  }
                  searchMentionCallback={async () => ({})}
                  uploadFile={async () => {
                    throw new Error("请在实际任务中上传附件。");
                  }}
                  duplicateFile={async () => {
                    throw new Error("请在实际任务中上传附件。");
                  }}
                  containerClassName="min-h-40 pt-3"
                />
              </div>
              <fieldset className="flex flex-wrap gap-3">
                <legend>推荐给（仅推荐，不自动分配任务）</legend>
                {(memberStore.getProjectMemberIds(projectId, false) ?? []).map((id) => (
                  <label key={id} className="flex items-center gap-1">
                    <input
                      type="checkbox"
                      checked={editing.recommended_member_ids?.includes(id) ?? false}
                      onChange={(event) =>
                        setEditing({
                          ...editing,
                          recommended_member_ids: event.target.checked
                            ? [...(editing.recommended_member_ids ?? []), id]
                            : (editing.recommended_member_ids ?? []).filter((item) => item !== id),
                        })
                      }
                    />
                    {getUserDetails(id)?.display_name ?? "成员"}
                  </label>
                ))}
              </fieldset>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={editing.is_default ?? false}
                  onChange={(event) => setEditing({ ...editing, is_default: event.target.checked })}
                />
                作为默认模板
              </label>
              <div className="flex gap-2">
                <button
                  type="button"
                  className={button}
                  disabled={busy || !editing.name?.trim()}
                  onClick={() => void mutate(() => service.save(workspaceSlug, projectId, editing))}
                >
                  {busy ? "保存中…" : "保存模板"}
                </button>
                <button type="button" className={button} disabled={busy} onClick={() => setEditing(null)}>
                  取消
                </button>
              </div>
            </div>
          )}
        </div>
      )}
      {error && (
        <p role="alert" className="text-red-500">
          {error}
        </p>
      )}
    </div>
  );
});
