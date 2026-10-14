import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { MouseEvent } from "react";
import { Images, LayoutGrid, List, Search } from "lucide-react";
import { useParams, useSearchParams } from "next/navigation";
import { Button } from "@plane/propel/button";
import { Input } from "@plane/propel/input";
import { Tabs } from "@plane/propel/tabs";
import { artifactService } from "@/services/artifact.service";
import { AttachmentPreviewModal } from "@/components/issues/attachment/attachment-preview-modal";
import { PageHead } from "@/components/core/page-title";
import {
  ALL_GALLERY_CATEGORY,
  filterGalleryCards,
  getGalleryCategoryCounts,
  groupGalleryCards,
  orderGalleryCards,
  parseGalleryViewState,
  sanitizeGalleryReturnUrl,
  serializeGalleryViewState,
  resolveGalleryAction,
} from "../../../../../core/helpers/gallery";
import type { GalleryAttachment, GalleryCard, GalleryResponse } from "../../../../../core/helpers/gallery";
import { galleryService } from "@/services/gallery.service";
import { GalleryListRow, GalleryResult } from "@/components/artifacts/gallery-result";

const emptyCards: GalleryCard[] = [];
const emptyCategories: string[] = [];
const attachmentHref = (attachment: GalleryAttachment) => attachment.file_url;

export default function GalleryPage() {
  const { workspaceSlug } = useParams();
  const searchParams = useSearchParams();
  const slug = workspaceSlug?.toString() ?? "";
  const [initial] = useState(() => parseGalleryViewState(searchParams.toString()));
  const [canCreate, setCanCreate] = useState(false);
  const [data, setData] = useState<GalleryResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [category, setCategory] = useState(initial.category);
  const [query, setQuery] = useState(initial.query);
  const [layout, setLayout] = useState(initial.layout);
  const [sort, setSort] = useState(initial.sort);
  const [group, setGroup] = useState(initial.group);
  const [previewAttachment, setPreviewAttachment] = useState<GalleryAttachment | null>(null);
  const [urlReady, setUrlReady] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  const loadGallery = useCallback(async () => {
    setLoading(true);
    setError(false);
    try {
      const response = await galleryService.getGallery(slug);
      setData(response);
    } catch {
      setError(true);
    }
    try {
      const permission = await artifactService.list(slug);
      setCanCreate(permission.can_create);
    } catch {
      setCanCreate(false);
    } finally {
      setLoading(false);
    }
  }, [slug]);
  useEffect(() => {
    void loadGallery();
  }, [loadGallery]);

  const cards = data?.cards ?? emptyCards;
  const categories = data?.categories ?? emptyCategories;
  const categoryChoices = useMemo(() => {
    const known = new Map<string, { id: string; name: string }>();
    for (const card of cards)
      if (card.category_id) known.set(card.category_id, { id: card.category_id, name: card.category });
    return [...known.values()];
  }, [cards]);
  const counts = useMemo(() => getGalleryCategoryCounts(cards, categories), [cards, categories]);
  const visibleCards = useMemo(
    () => orderGalleryCards(filterGalleryCards(cards, category, query), sort),
    [cards, category, query, sort]
  );
  const groups = useMemo(() => groupGalleryCards(visibleCards, group), [visibleCards, group]);

  useEffect(() => {
    if (!categoryChoices.length) return;
    if (category !== ALL_GALLERY_CATEGORY && !categoryChoices.some((item) => item.id === category))
      setCategory(ALL_GALLERY_CATEGORY);
  }, [category, categoryChoices]);
  useEffect(() => {
    const params = new URLSearchParams(searchParams.toString());
    const hasLayout = params.has("layout");
    if (!urlReady) {
      if (!hasLayout) {
        try {
          const preference = window.localStorage.getItem(`gallery-layout:${slug}`);
          if (preference === "gallery" || preference === "list") setLayout(preference);
        } catch {
          /* Browser storage can be disabled. */
        }
      }
      setUrlReady(true);
      return;
    }
    const state = { category, query, layout, sort, group };
    const nextQuery = serializeGalleryViewState(state);
    const nextUrl = `/${encodeURIComponent(slug)}/gallery/${nextQuery ? `?${nextQuery}` : ""}`;
    const currentUrl = `${window.location.pathname}${window.location.search}`;
    if (currentUrl !== nextUrl) window.history.replaceState(window.history.state, "", nextUrl);
    try {
      window.localStorage.setItem(`gallery-layout:${slug}`, layout);
    } catch {
      /* Browser storage can be disabled. */
    }
  }, [category, query, layout, sort, group, searchParams, slug, urlReady]);

  const detailHref = (card: GalleryCard) => {
    const queryString = serializeGalleryViewState({ category, query, layout, sort, group });
    const returnUrl = sanitizeGalleryReturnUrl(
      `/${encodeURIComponent(slug)}/gallery/${queryString ? `?${queryString}` : ""}`,
      slug
    );
    return `/${encodeURIComponent(slug)}/gallery/${encodeURIComponent(card.id)}/?from=${encodeURIComponent(returnUrl)}`;
  };
  const rememberScroll = (event: MouseEvent<HTMLAnchorElement>) => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    try {
      window.sessionStorage.setItem(`gallery-scroll:${slug}`, String(scrollRef.current?.scrollTop ?? 0));
    } catch {
      /* Session storage can be unavailable. */
    }
  };
  const openAttachment = (attachment: GalleryAttachment) => {
    if (attachment.can_preview) setPreviewAttachment(attachment);
    else window.open(attachment.file_url, "_blank", "noopener,noreferrer");
  };
  const categoryName = (id: string) => categoryChoices.find((item) => item.id === id)?.name ?? "全部成果";

  useEffect(() => {
    if (!urlReady || loading) return;
    let saved: string | null = null;
    try {
      saved = window.sessionStorage.getItem(`gallery-scroll:${slug}`);
      window.sessionStorage.removeItem(`gallery-scroll:${slug}`);
    } catch {
      /* Session storage can be unavailable. */
    }
    if (saved !== null)
      requestAnimationFrame(() => {
        if (scrollRef.current) scrollRef.current.scrollTop = Number(saved) || 0;
      });
  }, [loading, slug, urlReady]);

  return (
    <div ref={scrollRef} className="h-full min-h-0 overflow-y-auto bg-surface-1 text-primary">
      <PageHead title="成果与应用" />
      <header className="border-b border-subtle bg-surface-1 px-4 py-3 md:px-8">
        <div className="mx-auto flex max-w-[1440px] items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <span className="grid size-9 place-items-center rounded-md bg-surface-2 text-accent-primary">
              <Images className="size-5" />
            </span>
            <div>
              <h1 className="text-16 font-semibold">成果与应用</h1>
              <p className="text-12 text-secondary">可查看的应用、演示与交付资料</p>
            </div>
          </div>
          {canCreate && (
            <div className="flex gap-2">
              <a
                href={`/${slug}/gallery/manage/`}
                className="rounded-md border border-subtle-1 px-3 py-2 text-12 text-secondary hover:bg-surface-2"
              >
                管理成果
              </a>
              <a
                href={`/${slug}/gallery/new/`}
                className="rounded-md bg-accent-primary px-3 py-2 text-12 text-on-color hover:bg-accent-primary-hover"
              >
                新建成果
              </a>
            </div>
          )}
        </div>
      </header>
      <main className="mx-auto max-w-[1440px] px-4 py-5 md:px-8 md:py-7">
        <section className="mb-5 flex flex-wrap items-center justify-between gap-3">
          <p className="max-w-3xl text-13 text-secondary">从真实工作项中整理的应用入口、操作演示与交付资料。</p>
          {data && (
            <div className="flex gap-5 text-12 text-secondary">
              <span>
                <strong className="mr-1 text-16 text-primary">{data.stats.total}</strong>收录成果
              </span>
              <span>
                <strong className="mr-1 text-16 text-primary">{data.stats.with_demo}</strong>含演示材料
              </span>
            </div>
          )}
        </section>
        <section
          aria-label="成果筛选"
          className="mb-4 flex flex-wrap items-center gap-2 rounded-lg border border-subtle bg-surface-1 p-3"
        >
          <div className="relative min-w-52 flex-1 basis-64">
            <Search className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-tertiary" />
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="搜索成果、工作项或材料"
              aria-label="搜索成果"
              className="w-full pl-9"
            />
          </div>
          <select
            aria-label="筛选类别"
            value={category}
            onChange={(event) => setCategory(event.target.value)}
            className="h-8 min-w-40 rounded-md border border-subtle-1 bg-layer-2 px-3 text-13 text-primary"
          >
            <option value={ALL_GALLERY_CATEGORY}>全部类别 ({counts[ALL_GALLERY_CATEGORY] ?? 0})</option>
            {categoryChoices.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name} ({counts[item.name] ?? 0})
              </option>
            ))}
          </select>
          <select
            aria-label="排序成果"
            value={sort}
            onChange={(event) => setSort(event.target.value as typeof sort)}
            className="h-8 rounded-md border border-subtle-1 bg-layer-2 px-3 text-13 text-primary"
          >
            <option value="curated">精选顺序</option>
            <option value="recent">最近更新</option>
            <option value="title">名称</option>
          </select>
          <select
            aria-label="分组成果"
            value={group}
            onChange={(event) => setGroup(event.target.value as typeof group)}
            className="h-8 rounded-md border border-subtle-1 bg-layer-2 px-3 text-13 text-primary"
          >
            <option value="none">不分组</option>
            <option value="category">按类别分组</option>
          </select>
          <Tabs value={layout} onValueChange={(value) => setLayout(value as typeof layout)}>
            <Tabs.List className="h-8 rounded-md border border-subtle-1 bg-layer-2 p-0.5">
              <Tabs.Trigger
                value="gallery"
                aria-label="卡片视图"
                className="flex h-7 items-center gap-1 rounded px-2 text-12"
              >
                <LayoutGrid className="size-3.5" />
                卡片
              </Tabs.Trigger>
              <Tabs.Trigger
                value="list"
                aria-label="列表视图"
                className="flex h-7 items-center gap-1 rounded px-2 text-12"
              >
                <List className="size-3.5" />
                列表
              </Tabs.Trigger>
            </Tabs.List>
          </Tabs>
        </section>
        <div className="mb-3 flex items-center justify-between text-12 text-secondary">
          <h2 className="font-medium">{category === ALL_GALLERY_CATEGORY ? "全部成果" : categoryName(category)}</h2>
          <span>{loading ? "正在加载…" : `${visibleCards.length} 项`}</span>
        </div>
        {loading ? (
          <div
            role="status"
            className="rounded-lg border border-subtle bg-surface-1 p-10 text-center text-13 text-secondary"
          >
            正在加载成果…
          </div>
        ) : error ? (
          <div className="rounded-lg border border-subtle bg-surface-1 p-10 text-center">
            <h2 className="text-16 font-semibold">暂时无法加载成果</h2>
            <p className="mt-2 text-13 text-secondary">请检查连接后重试。</p>
            <Button className="mt-4" onClick={() => void loadGallery()}>
              重新加载
            </Button>
          </div>
        ) : visibleCards.length ? (
          <div className="space-y-6">
            {groups.map((section) => (
              <section key={section.name || "all"} aria-label={section.name ? `${section.name}成果` : "成果列表"}>
                {section.name && (
                  <h3 className="mb-3 border-b border-subtle pb-2 text-14 font-semibold">
                    {section.name}
                    <span className="font-normal ml-2 text-12 text-tertiary">{section.cards.length}</span>
                  </h3>
                )}
                {layout === "gallery" ? (
                  <div className="grid grid-cols-1 items-stretch gap-4 sm:grid-cols-2 xl:grid-cols-3">
                    {section.cards.map((card) => (
                      <GalleryResult
                        key={card.id}
                        card={card}
                        href={detailHref(card)}
                        attachmentHref={attachmentHref}
                        primary={resolveGalleryAction(card)}
                        openAttachment={openAttachment}
                        onOpenDetail={rememberScroll}
                      />
                    ))}
                  </div>
                ) : (
                  <div className="overflow-hidden rounded-lg border border-subtle bg-surface-1">
                    {section.cards.map((card) => (
                      <GalleryListRow
                        key={card.id}
                        card={card}
                        href={detailHref(card)}
                        primary={resolveGalleryAction(card)}
                        openAttachment={openAttachment}
                        onOpenDetail={rememberScroll}
                      />
                    ))}
                  </div>
                )}
              </section>
            ))}
          </div>
        ) : (
          <div className="rounded-lg border border-dashed border-subtle-1 bg-surface-1 px-6 py-14 text-center">
            <Images className="mx-auto size-8 text-tertiary" />
            <h3 className="mt-3 text-16 font-semibold">
              {query || category !== ALL_GALLERY_CATEGORY ? "没有匹配的成果" : "暂未收录成果"}
            </h3>
            <p className="mt-2 text-13 text-secondary">
              {query || category !== ALL_GALLERY_CATEGORY
                ? "调整类别或关键词后再试。"
                : "整理完成的应用与材料会显示在这里。"}
            </p>
          </div>
        )}
        <footer className="mt-7 border-t border-subtle pt-3 text-11 text-tertiary">
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
