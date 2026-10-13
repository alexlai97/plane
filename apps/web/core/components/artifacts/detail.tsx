import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { artifactService } from "@/services/artifact.service";
import { artifactError } from "../../helpers/artifact";
import type { Artifact } from "../../helpers/artifact";
import type { GalleryAttachment } from "../../helpers/gallery";
import { getGallerySourceHref, isSafeHttpUrl, resolveGalleryAction } from "../../helpers/gallery";
import { AttachmentPreviewModal } from "@/components/issues/attachment/attachment-preview-modal";
import { ArtifactShell, buttonClass, Message, primaryClass, Section } from "./shared";

export default function ArtifactDetailPage() {
  const params = useParams();
  const slug = params.workspaceSlug?.toString() ?? "";
  const id = params.artifactId?.toString() ?? "";
  const view =
    typeof window !== "undefined" && new URLSearchParams(window.location.search).get("view") === "draft"
      ? "draft"
      : "published";
  const [artifact, setArtifact] = useState<Artifact>();
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [preview, setPreview] = useState<GalleryAttachment>();
  const [message, setMessage] = useState("");
  const load = useCallback(async () => {
    setError("");
    setLoading(true);
    try {
      setArtifact(await artifactService.detail(slug, id, view));
    } catch (e) {
      setError(artifactError(e));
    } finally {
      setLoading(false);
    }
  }, [slug, id, view]);
  useEffect(() => {
    void load();
  }, [load]);
  const openAttachment = (attachment: GalleryAttachment) => {
    if (attachment.can_preview) setPreview(attachment);
    else window.open(attachment.file_url, "_blank", "noopener,noreferrer");
  };
  const primary = () => {
    if (!artifact) return;
    const action = resolveGalleryAction(artifact);
    if (action.type === "link") window.open(action.url, "_blank", "noopener,noreferrer");
    else if (action.type === "attachment") openAttachment(action.attachment);
  };
  return (
    <ArtifactShell
      slug={slug}
      title={artifact?.title ?? "成果详情"}
      actions={
        <>
          {artifact?.can_edit && (
            <a href={`/${slug}/gallery/${id}/edit/`} className={buttonClass}>
              编辑成果
            </a>
          )}
          {artifact && (
            <button
              className={buttonClass}
              onClick={() => {
                void navigator.clipboard.writeText(window.location.href).then(
                  () => setMessage("成果链接已复制。"),
                  () => setError("复制失败，请从浏览器地址栏复制链接。")
                );
              }}
            >
              复制链接
            </button>
          )}
        </>
      }
    >
      <Message error={error} message={message} />
      {loading ? (
        <p role="status">正在加载成果…</p>
      ) : !artifact ? (
        <button className={buttonClass} onClick={() => void load()}>
          重新加载
        </button>
      ) : (
        <div className="space-y-5">
          {view === "draft" && (
            <p className="border-amber-200 bg-amber-50 text-sm text-amber-800 rounded-md border p-3">
              草稿预览 · 当前内容尚未发布到成果展厅。
            </p>
          )}
          <Section title="成果说明">
            <div className="text-xs flex flex-wrap gap-2 text-[#60758c]">
              <span>{artifact.category || "未分类"}</span>
              <span>{artifact.kind}</span>
              <span>更新于 {new Date(artifact.updated_at).toLocaleString("zh-CN")}</span>
            </div>
            <p className="text-sm leading-7 whitespace-pre-wrap text-[#60758c]">{artifact.summary}</p>
            {artifact.cover && (
              <img
                src={artifact.cover.source_url}
                alt={`${artifact.title}封面`}
                className="max-h-80 max-w-full rounded-md object-contain"
              />
            )}
            {artifact.primary_action.type !== "detail" && (
              <button className={primaryClass} onClick={primary}>
                {artifact.primary_action.label}
              </button>
            )}
          </Section>
          {artifact.sources.length > 0 && (
            <Section title="关联工作项">
              {artifact.sources.map((source) => (
                <a
                  key={source.id}
                  href={getGallerySourceHref(slug, source)}
                  className="text-sm block rounded-md border border-[#dce5ef] p-3 text-[#2d628b] hover:bg-[#edf3f9]"
                >
                  {source.identifier} · {source.name}
                  <span className="text-xs mt-1 block text-[#718399]">{source.project_name}</span>
                </a>
              ))}
            </Section>
          )}
          {artifact.attachments.length > 0 && (
            <Section title="交付材料">
              <div className="flex flex-wrap gap-3">
                {artifact.attachments.map((attachment) => (
                  <button key={attachment.id} className={buttonClass} onClick={() => openAttachment(attachment)}>
                    {attachment.can_preview ? "预览" : "下载"} · {attachment.name}
                  </button>
                ))}
              </div>
            </Section>
          )}
          {artifact.links.length > 0 && (
            <Section title="应用与演示">
              <div className="flex flex-wrap gap-3">
                {artifact.links
                  .filter((link) => isSafeHttpUrl(link.url))
                  .map((link) => (
                    <a
                      key={`${link.kind}-${link.url}`}
                      href={link.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className={buttonClass}
                    >
                      {link.title}
                      {link.kind === "demo" ? " · 外部演示" : ""} ↗
                    </a>
                  ))}
              </div>
            </Section>
          )}
          {artifact.unavailable_reference_count > 0 && (
            <p className="text-sm text-amber-800">有 {artifact.unavailable_reference_count} 项引用当前不可用。</p>
          )}
        </div>
      )}
      {preview && (
        <AttachmentPreviewModal
          fileName={preview.name}
          fileURL={preview.file_url}
          onClose={() => setPreview(undefined)}
        />
      )}
    </ArtifactShell>
  );
}
