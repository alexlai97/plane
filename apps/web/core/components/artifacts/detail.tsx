import { useCallback, useEffect, useState } from "react";
import { useParams, useSearchParams } from "next/navigation";
import { ArrowDownToLine, Eye, FileText } from "lucide-react";
import { artifactService } from "@/services/artifact.service";
import { artifactError } from "../../helpers/artifact";
import type { Artifact } from "../../helpers/artifact";
import type { GalleryAttachment } from "../../helpers/gallery";
import {
  getGallerySourceHref,
  isSafeHttpUrl,
  resolveGalleryAction,
  sanitizeGalleryReturnUrl,
} from "../../helpers/gallery";
import { AttachmentPreviewModal } from "@/components/issues/attachment/attachment-preview-modal";
import { ArtifactShell, buttonClass, CopyLinkButton, Message, primaryClass, Section } from "./shared";

export default function ArtifactDetailPage() {
  const params = useParams();
  const searchParams = useSearchParams();
  const slug = params.workspaceSlug?.toString() ?? "";
  const id = params.artifactId?.toString() ?? "";
  const returnHref = sanitizeGalleryReturnUrl(searchParams.get("from"), slug);
  const view =
    typeof window !== "undefined" && new URLSearchParams(window.location.search).get("view") === "draft"
      ? "draft"
      : "published";
  const [artifact, setArtifact] = useState<Artifact>();
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [preview, setPreview] = useState<GalleryAttachment>();
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
      returnHref={returnHref}
      actions={
        <>
          {artifact?.can_edit && (
            <a href={`/${slug}/gallery/${id}/edit/`} className={buttonClass}>
              编辑成果
            </a>
          )}
          {artifact && <CopyLinkButton />}
        </>
      }
    >
      <Message error={error} />
      {loading ? (
        <p role="status">正在加载成果…</p>
      ) : !artifact ? (
        <button type="button" className={buttonClass} onClick={() => void load()}>
          重新加载
        </button>
      ) : (
        <div className="space-y-5">
          {view === "draft" && (
            <p className="text-sm rounded-md border border-warning-strong/30 bg-warning-subtle p-3 text-warning-primary">
              草稿预览 · 当前内容尚未发布到成果展厅。
            </p>
          )}
          <Section title="成果说明">
            <div className="text-xs flex flex-wrap gap-2 text-secondary">
              <span>{artifact.category || "未分类"}</span>
              <span>{artifact.kind}</span>
              <span>更新于 {new Date(artifact.updated_at).toLocaleString("zh-CN")}</span>
            </div>
            <p className="text-sm leading-7 whitespace-pre-wrap text-secondary">{artifact.summary}</p>
            {artifact.cover && (
              <button
                type="button"
                onClick={() =>
                  setPreview({
                    id: artifact.cover!.asset_id,
                    name: artifact.cover!.name,
                    size: 0,
                    mime: "image/*",
                    issue_id: "",
                    file_url: artifact.cover!.file_url,
                    source_url: artifact.cover!.source_url,
                    can_preview: true,
                  })
                }
                aria-label="放大封面图片"
                className="focus-visible:ring-accent-primary block rounded-md outline-none focus-visible:ring-2"
              >
                <img
                  src={artifact.cover.source_url}
                  alt={`${artifact.title}封面，点击放大`}
                  className="max-h-80 max-w-full rounded-md object-contain"
                />
              </button>
            )}
            {artifact.primary_action.type !== "detail" && (
              <button type="button" className={primaryClass} onClick={primary}>
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
                  className="text-sm block rounded-md border border-subtle p-3 text-link-primary hover:bg-surface-2"
                >
                  {source.identifier} · {source.name}
                  <span className="text-xs mt-1 block text-tertiary">{source.project_name}</span>
                </a>
              ))}
            </Section>
          )}
          {artifact.attachments.length > 0 && (
            <Section title="交付材料">
              <div id="materials" className="divide-y divide-subtle rounded-md border border-subtle">
                {artifact.attachments.map((attachment) => (
                  <div key={attachment.id} className="flex flex-wrap items-center gap-3 p-3">
                    {attachment.can_preview ? (
                      <Eye className="size-4 shrink-0 text-secondary" />
                    ) : (
                      <FileText className="size-4 shrink-0 text-secondary" />
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-13 font-medium text-primary">{attachment.name}</p>
                      <p className="mt-0.5 text-11 text-tertiary">
                        {attachment.size ? `${(attachment.size / 1024 / 1024).toFixed(1)} MB` : "大小未知"}
                      </p>
                    </div>
                    {artifact.primary_action.type === "attachment" &&
                      artifact.primary_action.attachment_id === attachment.id && (
                        <span className="rounded bg-accent-primary/10 px-2 py-1 text-11 text-accent-primary">
                          默认操作
                        </span>
                      )}
                    <button type="button" className={buttonClass} onClick={() => openAttachment(attachment)}>
                      {attachment.can_preview ? (
                        <>
                          <Eye className="mr-1 inline size-3.5" />
                          预览
                        </>
                      ) : (
                        <>
                          <ArrowDownToLine className="mr-1 inline size-3.5" />
                          下载
                        </>
                      )}
                    </button>
                  </div>
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
            <p className="text-sm text-warning-primary">有 {artifact.unavailable_reference_count} 项引用当前不可用。</p>
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
