import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowUpRight, BriefcaseBusiness, Images, Search } from "lucide-react";
import { useParams, useRouter } from "next/navigation";
import { artifactService } from "@/services/artifact.service";
import { AttachmentPreviewModal } from "@/components/issues/attachment/attachment-preview-modal";
import { PageHead } from "@/components/core/page-title";
import {
  ALL_GALLERY_CATEGORY,
  filterGalleryCards,
  getGalleryCategoryCounts,
  resolveGalleryAction,
} from "../../../../../core/helpers/gallery";
import type { GalleryAttachment, GalleryCard, GalleryResponse } from "../../../../../core/helpers/gallery";
import { galleryService } from "@/services/gallery.service";

const emptyCards: GalleryCard[] = [];
const emptyCategories: string[] = [];

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

export default function GalleryPage() {
  const { workspaceSlug } = useParams();
  const router = useRouter();
  const [canCreate, setCanCreate] = useState(false);
  const slug = workspaceSlug?.toString() ?? "";
  const [data, setData] = useState<GalleryResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [category, setCategory] = useState(ALL_GALLERY_CATEGORY);
  const [query, setQuery] = useState("");
  const [previewAttachment, setPreviewAttachment] = useState<GalleryAttachment | null>(null);

  const loadGallery = useCallback(async () => {
    setLoading(true);
    setError(false);
    try {
      const response = await galleryService.getGallery(slug);
      setData(response);
      const permission = await artifactService.list(slug);
      setCanCreate(permission.can_create);
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
      router.push(`/${slug}/gallery/${card.id}/`);
    }
  };

  return (
    <div className="h-full min-h-0 overflow-y-auto bg-[#f5f8fc] text-[#19334d]">
      <PageHead title="成果与应用" />
      <header className="border-b border-[#dce5ef] bg-white px-6 py-5 md:px-10">
        <div className="mx-auto flex max-w-[1440px] items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="grid size-10 place-items-center rounded-lg border border-[#dce5ef] bg-white text-[#2d628b]">
              <Images className="size-5" />
            </div>
            <div>
              <p className="text-16 font-semibold">成果与应用</p>
              <p className="text-12 text-[#718399]">可查看的应用、演示与交付资料</p>
            </div>
          </div>
          {canCreate && (
            <div className="flex flex-wrap gap-3 text-13">
              <a href={`/${slug}/gallery/manage/`} className="rounded-md border border-[#d7e1ed] px-3 py-2">
                管理成果
              </a>
              <a href={`/${slug}/gallery/new/`} className="rounded-md bg-[#2d628b] px-3 py-2 text-white">
                新建成果
              </a>
            </div>
          )}
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
                      onClick={() => router.push(`/${slug}/gallery/${card.id}/`)}
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
          成果内容由工作区成员维护；保存草稿后需发布才会更新展厅。
        </footer>
      </main>

      {previewAttachment?.can_preview && (
        <AttachmentPreviewModal
          fileName={previewAttachment.name}
          fileURL={previewAttachment.file_url}
          onClose={() => setPreviewAttachment(null)}
        />
      )}
    </div>
  );
}
