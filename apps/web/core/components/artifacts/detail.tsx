import { ArtifactAssignees } from "./assignees";
import { useEffect, useRef, useState } from "react";
import { useParams, useSearchParams } from "next/navigation";
import { Dialog } from "@headlessui/react";
import { ArrowDownToLine, ArrowLeft, ExternalLink, Eye, FileText, X } from "lucide-react";
import { ModalPortal, EPortalWidth, EPortalPosition } from "@plane/propel/portal";
import useKeypress from "@/hooks/use-keypress";
import { artifactService } from "@/services/artifact.service";
import { artifactError, getArtifactShareUrl, resolveArtifactCoverPreview } from "../../helpers/artifact";
import type { Artifact } from "../../helpers/artifact";
import type { GalleryAttachment } from "../../helpers/gallery";
import {
  getGalleryDetailHref,
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
  const view = searchParams.get("view") === "draft" ? "draft" : "published";
  return (
    <ArtifactDetail
      key={`${id}:${view}`}
      slug={slug}
      id={id}
      view={view}
      returnHref={sanitizeGalleryReturnUrl(searchParams.get("from"), slug)}
    />
  );
}

export function ArtifactDetail({
  slug,
  id,
  view = "published",
  returnHref,
  onClose,
  initialSection,
}: {
  slug: string;
  id: string;
  view?: "draft" | "published";
  returnHref: string;
  onClose?: () => void;
  initialSection?: "materials";
}) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const materialsRef = useRef<HTMLDivElement>(null);
  const [retry, setRetry] = useState(0);
  const standaloneHref = getGalleryDetailHref(slug, id, returnHref);
  const isPeek = Boolean(onClose);
  useEffect(() => {
    if (!isPeek) return;
    const frame = requestAnimationFrame(() => closeRef.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [id, isPeek]);
  useKeypress("Escape", (event) => {
    if (
      !onClose ||
      event.defaultPrevented ||
      document.querySelector(
        '[data-bokang-attachment-preview], [data-artifact-media-preview], [data-slot="dialog-content"]'
      )
    )
      return;
    event.preventDefault();
    onClose();
  });
  const [artifact, setArtifact] = useState<Artifact>();
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [preview, setPreview] = useState<GalleryAttachment>();
  const [coverImagePreview, setCoverImagePreview] = useState<GalleryAttachment>();
  const [failedCoverId, setFailedCoverId] = useState<string>();
  useEffect(() => {
    let active = true;
    setError("");
    setLoading(true);
    setArtifact(undefined);
    void (async () => {
      try {
        const item = await artifactService.detail(slug, id, view);
        if (active) setArtifact(item);
      } catch (cause) {
        if (active) setError(artifactError(cause));
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [slug, id, view, retry]);
  useEffect(() => {
    if (!artifact || (initialSection !== "materials" && window.location.hash !== "#materials")) return;
    const frame = requestAnimationFrame(() => materialsRef.current?.scrollIntoView({ block: "start" }));
    return () => cancelAnimationFrame(frame);
  }, [artifact, initialSection]);
  const load = () => setRetry((value) => value + 1);
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
  const coverPreview = resolveArtifactCoverPreview(artifact?.cover, artifact?.attachments ?? []);
  const coverImageFailed = Boolean(artifact?.cover && failedCoverId === artifact.cover.asset_id);
  const openCoverPreview = () => {
    if (!coverPreview) return;
    if (coverPreview.type === "image") setCoverImagePreview(coverPreview.attachment);
    else openAttachment(coverPreview.attachment);
  };
  const actions = (
    <>
      {artifact?.can_edit && (
        <a
          href={`/${encodeURIComponent(slug)}/gallery/${encodeURIComponent(id)}/edit/?from=${encodeURIComponent(returnHref)}`}
          target={onClose ? "_blank" : undefined}
          rel={onClose ? "noopener noreferrer" : undefined}
          className={buttonClass}
        >
          编辑成果
        </a>
      )}
      {artifact && (
        <CopyLinkButton
          getValue={() =>
            getArtifactShareUrl(new URL(getGalleryDetailHref(slug, id), window.location.origin).href, view)
          }
        />
      )}
    </>
  );
  const content = (
    <>
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
            <div className="mb-3 flex items-center gap-2 text-13 text-secondary">
              <span>负责人</span>
              <ArtifactAssignees ids={artifact.assignee_ids} showNames />
            </div>
            <div className="text-xs flex flex-wrap gap-2 text-secondary">
              <span>{artifact.category || "未分类"}</span>
              <span>{artifact.kind}</span>
              <span>更新于 {new Date(artifact.updated_at).toLocaleString("zh-CN")}</span>
            </div>
            <p className="text-sm leading-7 whitespace-pre-wrap text-secondary">{artifact.summary}</p>
            {artifact.cover && !coverImageFailed && (
              <button
                type="button"
                onClick={openCoverPreview}
                aria-label={coverPreview?.type === "image" ? "放大封面图片" : "预览封面材料"}
                disabled={!coverPreview}
                className="focus-visible:ring-accent-primary block rounded-md outline-none focus-visible:ring-2 disabled:cursor-default"
              >
                <img
                  src={artifact.cover.source_url}
                  alt={`${artifact.title}封面${coverPreview ? "，点击查看" : ""}`}
                  onError={() => setFailedCoverId(artifact.cover!.asset_id)}
                  className="max-h-80 max-w-full rounded-md object-contain"
                />
              </button>
            )}
            {artifact.cover && coverImageFailed && coverPreview && (
              <button
                type="button"
                onClick={openCoverPreview}
                className="text-sm flex items-center gap-2 rounded-md border border-subtle p-3 text-link-primary hover:bg-surface-2"
              >
                {coverPreview.type === "image" ? <Eye className="size-4" /> : <FileText className="size-4" />}
                {coverPreview.attachment.name}
                {coverPreview.type === "image"
                  ? " · 查看图片"
                  : coverPreview.attachment.can_preview
                    ? " · 预览材料"
                    : " · 下载材料"}
              </button>
            )}
            {artifact.cover && coverImageFailed && !coverPreview && (
              <p className="text-sm flex items-center gap-2 rounded-md border border-subtle p-3 text-secondary">
                <FileText className="size-4" />
                {artifact.cover.name} · 封面材料当前不可预览
              </p>
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
                  target={onClose ? "_blank" : undefined}
                  rel={onClose ? "noopener noreferrer" : undefined}
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
              <div ref={materialsRef} id="materials" className="divide-y divide-subtle rounded-md border border-subtle">
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
      {coverImagePreview && (
        <Dialog
          open
          onClose={() => setCoverImagePreview(undefined)}
          data-artifact-media-preview
          data-prevent-outside-click
          className="relative z-[100]"
        >
          <div className="fixed inset-0 bg-black/80" aria-hidden="true" />
          <Dialog.Panel className="fixed inset-0 flex flex-col bg-black/80 p-3 sm:p-5">
            <div className="flex items-center justify-between gap-3 pb-3 text-white">
              <Dialog.Title className="text-sm truncate font-medium">{coverImagePreview.name}</Dialog.Title>
              <button
                type="button"
                aria-label="关闭封面图片预览"
                onClick={() => setCoverImagePreview(undefined)}
                className="rounded p-2 hover:bg-white/10"
              >
                <X className="size-5" />
              </button>
            </div>
            <div className="flex min-h-0 flex-1 items-center justify-center overflow-auto">
              <img
                src={coverImagePreview.source_url}
                alt={coverImagePreview.name}
                className="max-h-full max-w-full object-contain"
              />
            </div>
          </Dialog.Panel>
        </Dialog>
      )}
    </>
  );
  if (onClose)
    return (
      <ModalPortal
        isOpen
        ariaLabel="成果详情"
        width={EPortalWidth.HALF}
        position={EPortalPosition.RIGHT}
        showOverlay={false}
        closeOnEscape={false}
        className="pointer-events-none"
        contentClassName="pointer-events-auto flex w-full min-w-0 max-w-none flex-col overflow-hidden border-l border-subtle bg-surface-1 md:w-[56%] lg:max-w-3xl"
      >
        <div data-artifact-detail className="flex h-full min-h-0 flex-col bg-surface-1 text-primary">
          <header className="flex shrink-0 flex-wrap items-center gap-2 border-b border-subtle px-4 py-3">
            <button
              ref={closeRef}
              type="button"
              onClick={onClose}
              aria-label="关闭成果详情"
              title="关闭成果详情（Esc）"
              className={buttonClass}
            >
              <X aria-hidden="true" className="size-4" />
            </button>
            <h2 className="min-w-0 flex-1 truncate text-16 font-semibold">{artifact?.title ?? "成果详情"}</h2>
            <a
              href={standaloneHref}
              target="_blank"
              rel="noopener noreferrer"
              title="在新标签页独立打开成果"
              className={buttonClass}
            >
              <ExternalLink aria-hidden="true" className="mr-1 inline size-3.5" />
              独立打开
            </a>
            <div className="flex w-full flex-wrap justify-end gap-2">{actions}</div>
          </header>
          <div className="min-h-0 flex-1 overflow-y-auto px-4 py-5 sm:px-6">{content}</div>
        </div>
      </ModalPortal>
    );
  return (
    <ArtifactShell
      slug={slug}
      title={artifact?.title ?? "成果详情"}
      returnHref={returnHref}
      actions={
        <>
          <a href={returnHref} className={buttonClass}>
            <ArrowLeft aria-hidden="true" className="mr-1 inline size-3.5" />
            返回总览
          </a>
          {actions}
        </>
      }
    >
      {content}
    </ArtifactShell>
  );
}
