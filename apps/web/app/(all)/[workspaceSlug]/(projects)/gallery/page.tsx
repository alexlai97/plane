import { useCallback, useEffect, useMemo, useState } from "react";
import { Dialog } from "@headlessui/react";
import {
  ArrowDownToLine,
  ArrowUpRight,
  BriefcaseBusiness,
  ExternalLink,
  FileText,
  Images,
  Search,
  X,
} from "lucide-react";
import { useParams } from "next/navigation";
import { AttachmentPreviewModal } from "@/components/issues/attachment/attachment-preview-modal";
import { PageHead } from "@/components/core/page-title";
import {
  ALL_GALLERY_CATEGORY,
  filterGalleryCards,
  getGalleryCategoryCounts,
  getGallerySourceHref,
  isSafeHttpUrl,
  resolveGalleryAction,
} from "../../../../../core/helpers/gallery";
import type { GalleryAttachment, GalleryCard, GalleryResponse } from "../../../../../core/helpers/gallery";
import { galleryService } from "@/services/gallery.service";
import { useWorkspace } from "@/hooks/store/use-workspace";

const bokangWorkspaceId = "bb96243d-e9cd-424e-8fb6-6117ae54f621";
const emptyCards: GalleryCard[] = [];
const emptyCategories: string[] = [];

function formatDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? ""
    : new Intl.DateTimeFormat("zh-CN", { year: "numeric", month: "long", day: "numeric" }).format(date);
}

function formatSize(size: number): string {
  if (!Number.isFinite(size) || size <= 0) return "";
  if (size < 1024 * 1024) return `${Math.max(1, Math.round(size / 1024))} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

function isExternalDemoLink(card: GalleryCard): boolean {
  const action = card.primary_action;
  return action.type === "link" && card.links.some((link) => link.kind === "demo" && link.url === action.url);
}

function GalleryCover({ card }: { card: GalleryCard }) {
  const [failed, setFailed] = useState(false);
  if (card.cover?.source_url && !failed) {
    return (
      <img
        src={card.cover.source_url}
        alt={`${card.title}成果预览`}
        className="h-full w-full bg-white object-contain"
        onError={() => setFailed(true)}
      />
    );
  }
  return (
    <div className="mx-8 max-w-full rounded-lg border border-[#cbddeb] bg-white/80 px-5 py-4 text-center text-14 font-medium text-[#345a7a]">
      <span className="font-normal mb-1 block text-11 text-[#718399]">{card.kind}</span>
      <span className="line-clamp-2">{failed ? "暂无预览图" : (card.attachments[0]?.name ?? card.summary)}</span>
    </div>
  );
}

function GalleryAttachmentButton({
  attachment,
  onPreview,
}: {
  attachment: GalleryAttachment;
  onPreview: (attachment: GalleryAttachment) => void;
}) {
  if (attachment.can_preview) {
    return (
      <button
        type="button"
        onClick={() => onPreview(attachment)}
        className="inline-flex min-w-0 items-center gap-2 rounded-md border border-subtle bg-surface-1 px-3 py-2 text-left text-13 text-secondary hover:bg-layer-1"
      >
        <FileText className="size-4 flex-shrink-0" />
        <span className="truncate">{attachment.name}</span>
        {formatSize(attachment.size) && (
          <span className="flex-shrink-0 text-11 text-placeholder">{formatSize(attachment.size)}</span>
        )}
      </button>
    );
  }
  return (
    <a
      href={attachment.file_url}
      className="inline-flex min-w-0 items-center gap-2 rounded-md border border-subtle bg-surface-1 px-3 py-2 text-13 text-secondary hover:bg-layer-1"
      download={attachment.name}
    >
      <ArrowDownToLine className="size-4 flex-shrink-0" />
      <span className="truncate">{attachment.name}</span>
      {formatSize(attachment.size) && (
        <span className="flex-shrink-0 text-11 text-placeholder">{formatSize(attachment.size)}</span>
      )}
    </a>
  );
}

export default function GalleryPage() {
  const { workspaceSlug } = useParams();
  const { currentWorkspace } = useWorkspace();
  const slug = workspaceSlug?.toString() ?? "";
  const [data, setData] = useState<GalleryResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [category, setCategory] = useState(ALL_GALLERY_CATEGORY);
  const [query, setQuery] = useState("");
  const [selectedCard, setSelectedCard] = useState<GalleryCard | null>(null);
  const [previewAttachment, setPreviewAttachment] = useState<GalleryAttachment | null>(null);

  const loadGallery = useCallback(async () => {
    setLoading(true);
    setError(false);
    try {
      const response = await galleryService.getGallery(slug);
      setData(response);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, [slug]);

  useEffect(() => {
    void loadGallery();
  }, [loadGallery]);

  const cards = data?.cards ?? emptyCards;
  const categories = data?.categories ?? emptyCategories;
  const counts = useMemo(() => getGalleryCategoryCounts(cards, categories), [cards, categories]);
  const visibleCards = useMemo(() => filterGalleryCards(cards, category, query), [cards, category, query]);

  const openAttachment = (attachment: GalleryAttachment) => {
    if (attachment.can_preview) setPreviewAttachment(attachment);
    else window.open(attachment.file_url, "_blank", "noopener,noreferrer");
  };

  const handlePrimaryAction = (card: GalleryCard) => {
    const action = resolveGalleryAction(card);
    if (action.type === "link") {
      window.open(action.url, "_blank", "noopener,noreferrer");
    } else if (action.type === "attachment") {
      openAttachment(action.attachment);
    } else {
      setSelectedCard(card);
    }
  };

  const closeDetail = () => setSelectedCard(null);

  if (currentWorkspace && currentWorkspace.id !== bokangWorkspaceId) {
    return <div className="p-10 text-center text-secondary">该工作区没有成果展厅。</div>;
  }

  return (
    <div className="h-full min-h-0 overflow-y-auto bg-[#f5f8fc] text-[#19334d]">
      <PageHead title="泊康 · 成果与应用" />
      <header className="border-b border-[#dce5ef] bg-white px-6 py-5 md:px-10">
        <div className="mx-auto flex max-w-[1440px] items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="grid size-10 place-items-center rounded-lg border border-[#dce5ef] bg-white text-[#2d628b]">
              <Images className="size-5" />
            </div>
            <div>
              <p className="text-16 font-semibold">泊康 · 成果与应用</p>
              <p className="text-12 text-[#718399]">可查看的应用、演示与交付资料</p>
            </div>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-[1440px] px-5 py-8 md:px-10 md:py-10">
        <section className="mb-8 flex flex-col justify-between gap-5 md:flex-row md:items-end">
          <div>
            <h1 className="text-28 font-semibold tracking-tight md:text-32">成果与应用</h1>
            <p className="mt-2 text-14 text-[#60758c]">从真实工作项中整理的应用入口、操作演示与交付资料。</p>
          </div>
          {data && (
            <div className="flex gap-7 text-13 text-[#60758c]">
              <div>
                <strong className="mr-2 text-24 font-semibold text-[#244866]">{data.stats.total}</strong>收录成果
              </div>
              <div>
                <strong className="mr-2 text-24 font-semibold text-[#244866]">{data.stats.with_demo}</strong>含演示材料
              </div>
            </div>
          )}
        </section>

        {data && categories.length > 0 && (
          <nav aria-label="成果类别" className="mb-6 flex flex-wrap gap-2 border-b border-[#dce5ef] pb-5">
            {[ALL_GALLERY_CATEGORY, ...categories].map((item) => (
              <button
                key={item}
                type="button"
                onClick={() => setCategory(item)}
                aria-pressed={category === item}
                className={`rounded-md border px-3.5 py-2 text-13 transition-colors ${
                  category === item
                    ? "border-[#244f73] bg-[#244f73] text-white"
                    : "border-[#d7e1ed] bg-white text-[#49627b] hover:bg-[#edf3f9]"
                }`}
              >
                {item}
                <span className="ml-2 opacity-75">{counts[item] ?? 0}</span>
              </button>
            ))}
          </nav>
        )}

        <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <h2 className="text-16 font-semibold">
            {category === ALL_GALLERY_CATEGORY ? "全部成果" : category}
            <span className="font-normal ml-2 text-13 text-[#718399]">
              {loading ? "" : `${visibleCards.length} 项`}
            </span>
          </h2>
          <label className="flex w-full items-center gap-2 rounded-md border border-[#d7e1ed] bg-white px-3 py-2 sm:max-w-[340px]">
            <Search className="size-4 text-[#718399]" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="搜索成果、工作项或材料"
              aria-label="搜索成果"
              className="w-full bg-transparent text-13 outline-none placeholder:text-[#9aa9b8]"
            />
          </label>
        </div>

        {loading ? (
          <div
            role="status"
            className="rounded-xl border border-[#dce5ef] bg-white p-12 text-center text-14 text-[#718399]"
          >
            正在加载成果…
          </div>
        ) : error ? (
          <div className="rounded-xl border border-[#dce5ef] bg-white p-12 text-center">
            <h2 className="text-18 font-semibold">暂时无法加载成果</h2>
            <p className="mt-2 text-14 text-[#718399]">请检查连接后重试。</p>
            <button
              type="button"
              onClick={() => void loadGallery()}
              className="mt-5 rounded-md bg-[#2d628b] px-4 py-2 text-13 text-white"
            >
              重新加载
            </button>
          </div>
        ) : (
          <section aria-label="成果列表" className="grid grid-cols-1 gap-5 sm:grid-cols-2 xl:grid-cols-3">
            {visibleCards.map((card) => (
              <article
                key={card.id}
                className="overflow-hidden rounded-xl border border-[#dce5ef] bg-white shadow-[0_3px_12px_rgba(25,51,77,0.025)]"
              >
                <div className="relative flex h-[150px] items-center justify-center overflow-hidden bg-gradient-to-br from-[#e9f1f8] to-[#dce9f4]">
                  <GalleryCover card={card} />
                </div>
                <div className="p-5">
                  <div className="flex flex-wrap gap-1.5 text-11">
                    <span className="rounded bg-[#edf3f9] px-2 py-1 text-[#476c8e]">{card.category}</span>
                    <span className="rounded bg-[#f1f4f7] px-2 py-1 text-[#728195]">{card.kind}</span>
                  </div>
                  <h3 className="mt-3 line-clamp-2 text-18 font-semibold">{card.title}</h3>
                  <p className="mt-2 line-clamp-2 min-h-[44px] text-13 leading-6 text-[#61758a]">{card.summary}</p>
                  {card.attachments.length > 0 && (
                    <div className="mt-3 flex flex-wrap gap-1.5">
                      {card.attachments.slice(0, 2).map((attachment) => (
                        <button
                          key={attachment.id}
                          type="button"
                          onClick={() => openAttachment(attachment)}
                          className="max-w-full truncate text-left text-11 text-[#58758f] underline decoration-[#c6d4e1] underline-offset-2 hover:text-[#244f73]"
                        >
                          {attachment.can_preview ? "预览 · " : "下载 · "}
                          {attachment.name}
                        </button>
                      ))}
                      {card.attachments.length > 2 && (
                        <span className="text-11 text-[#8190a1]">另有 {card.attachments.length - 2} 项</span>
                      )}
                    </div>
                  )}
                  <div className="mt-5 flex items-center justify-between gap-3">
                    <button
                      type="button"
                      onClick={() => handlePrimaryAction(card)}
                      title={isExternalDemoLink(card) ? "链接可能需要对应外部平台的访问权限" : undefined}
                      className="inline-flex items-center gap-1.5 rounded-md border border-[#2d628b] bg-[#2d628b] px-3 py-2 text-12 font-medium text-white hover:bg-[#244f73]"
                    >
                      {card.primary_action.label}
                      {isExternalDemoLink(card) && <span className="font-normal text-11 opacity-80">· 外部</span>}
                      <ArrowUpRight className="size-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => setSelectedCard(card)}
                      className="text-12 text-[#58758f] hover:text-[#244f73]"
                    >
                      查看详情
                    </button>
                  </div>
                </div>
              </article>
            ))}
            {visibleCards.length === 0 && (
              <div className="col-span-full rounded-xl border border-dashed border-[#c9d7e5] bg-white px-6 py-14 text-center">
                <BriefcaseBusiness className="mx-auto size-8 text-[#9aa9b8]" />
                <h3 className="mt-3 text-18 font-semibold">{query ? "没有匹配的成果" : "暂未收录成果"}</h3>
                <p className="mt-2 text-13 text-[#718399]">
                  {query ? "试试其他关键词。" : "后续整理完成的应用与材料会显示在这里。"}
                </p>
              </div>
            )}
          </section>
        )}

        <footer className="mt-8 border-t border-[#dce5ef] pt-4 text-11 text-[#8797a8]">
          AI 战略部维护 · 数量按已收录的独立成果计算，业务归类为初版，可根据使用反馈调整。
        </footer>
      </main>

      {selectedCard && (
        <Dialog
          open
          onClose={() => {
            if (!previewAttachment) closeDetail();
          }}
          className="relative z-[80]"
          data-bokang-gallery-detail
        >
          <div className="fixed inset-0 bg-[#16354a]/45" aria-hidden="true" />
          <div className="fixed inset-0 flex items-center justify-center p-3 sm:p-6">
            <Dialog.Panel className="shadow-2xl max-h-[92vh] w-full max-w-[820px] overflow-y-auto rounded-xl border border-[#dce5ef] bg-white">
              <div className="sticky top-0 z-10 flex items-center justify-between border-b border-[#dce5ef] bg-white/95 px-5 py-4 backdrop-blur">
                <div className="flex flex-wrap gap-1.5 text-11">
                  <span className="rounded bg-[#edf3f9] px-2 py-1 text-[#476c8e]">{selectedCard.category}</span>
                  <span className="rounded bg-[#f1f4f7] px-2 py-1 text-[#728195]">{selectedCard.kind}</span>
                </div>
                <button
                  type="button"
                  onClick={closeDetail}
                  aria-label="关闭成果详情"
                  className="rounded-md p-2 text-[#60758c] hover:bg-[#edf3f9]"
                >
                  <X className="size-5" />
                </button>
              </div>
              <div className="p-5 sm:p-7">
                <Dialog.Title className="text-24 font-semibold">{selectedCard.title}</Dialog.Title>
                <p className="mt-2 text-14 leading-7 text-[#60758c]">{selectedCard.summary}</p>
                <p className="mt-2 text-11 text-[#8797a8]">更新于 {formatDate(selectedCard.updated_at)}</p>

                {selectedCard.sources.length > 0 && (
                  <section className="mt-7">
                    <h3 className="text-15 mb-2 font-semibold">关联工作项</h3>
                    <div className="divide-y divide-[#e6edf4] rounded-lg border border-[#dce5ef]">
                      {selectedCard.sources.map((source) => (
                        <a
                          key={source.id}
                          href={getGallerySourceHref(slug, source)}
                          className="flex items-start justify-between gap-4 px-4 py-3 hover:bg-[#f5f8fc]"
                        >
                          <span className="min-w-0">
                            <strong className="mr-2 text-12 text-[#58758f]">{source.identifier}</strong>
                            <span className="text-13 font-medium text-[#19334d]">{source.name}</span>
                            <span className="mt-1 block text-11 text-[#8190a1]">{source.project_name}</span>
                          </span>
                          <ExternalLink className="mt-1 size-4 flex-shrink-0 text-[#718399]" />
                        </a>
                      ))}
                    </div>
                  </section>
                )}

                {selectedCard.attachments.length > 0 && (
                  <section className="mt-7">
                    <h3 className="text-15 mb-2 font-semibold">交付材料</h3>
                    <div className="flex flex-wrap gap-2">
                      {selectedCard.attachments.map((attachment) => (
                        <GalleryAttachmentButton
                          key={attachment.id}
                          attachment={attachment}
                          onPreview={openAttachment}
                        />
                      ))}
                    </div>
                  </section>
                )}

                {selectedCard.links.some((link) => isSafeHttpUrl(link.url)) && (
                  <section className="mt-7">
                    <h3 className="text-15 mb-2 font-semibold">应用与演示</h3>
                    <div className="flex flex-wrap gap-2">
                      {selectedCard.links
                        .filter((link) => isSafeHttpUrl(link.url))
                        .map((link) => (
                          <a
                            key={`${link.kind}-${link.url}`}
                            href={link.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            title={link.kind === "demo" ? "链接可能需要对应外部平台的访问权限" : undefined}
                            className="inline-flex items-center gap-2 rounded-md border border-[#d7e1ed] px-3 py-2 text-13 text-[#49627b] hover:bg-[#edf3f9]"
                          >
                            {link.title}
                            {link.kind === "demo" && <span className="text-11 text-[#8190a1]">· 外部演示</span>}
                            <ExternalLink className="size-3.5" />
                          </a>
                        ))}
                    </div>
                  </section>
                )}
              </div>
            </Dialog.Panel>
          </div>
          {previewAttachment?.can_preview && (
            <AttachmentPreviewModal
              fileName={previewAttachment.name}
              fileURL={previewAttachment.file_url}
              onClose={() => setPreviewAttachment(null)}
            />
          )}
        </Dialog>
      )}

      {!selectedCard && previewAttachment?.can_preview && (
        <AttachmentPreviewModal
          fileName={previewAttachment.name}
          fileURL={previewAttachment.file_url}
          onClose={() => setPreviewAttachment(null)}
        />
      )}
    </div>
  );
}
