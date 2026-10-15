import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { MouseEvent } from "react";
import { Images, LayoutGrid, Network, Search } from "lucide-react";
import { useParams, useSearchParams, useLocation, useNavigate } from "react-router";
import { Header, EHeaderVariant } from "@plane/ui";
import { Button } from "@plane/propel/button";
import { Input } from "@plane/propel/input";
import { Tabs } from "@plane/propel/tabs";
import { PageHead } from "@/components/core/page-title";
import { GalleryOverview } from "@/components/artifacts/gallery-overview";
import { GalleryCards } from "@/components/artifacts/gallery-cards";
import { ArtifactDetail } from "@/components/artifacts/detail";
import { AttachmentPreviewModal } from "@/components/issues/attachment/attachment-preview-modal";
import {
  buildGalleryOverview,
  getGalleryDetailHref,
  parseGalleryViewState,
  serializeGalleryViewState,
  shouldOpenGalleryPeek,
} from "../../../../../core/helpers/gallery";
import type {
  GalleryCard,
  GalleryResponse,
  GalleryLayout,
  GalleryAttachment,
} from "../../../../../core/helpers/gallery";
import { galleryService } from "@/services/gallery.service";

const emptyCards: GalleryCard[] = [];
export default function GalleryPage() {
  const slug = useParams().workspaceSlug ?? "";
  const [searchParams, setSearchParams] = useSearchParams();
  const location = useLocation();
  const navigate = useNavigate();
  const { query, layout, peek } = parseGalleryViewState(searchParams.toString());
  const [data, setData] = useState<GalleryResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [preview, setPreview] = useState<GalleryAttachment>();
  const scrollRef = useRef<HTMLDivElement>(null);
  const restoredScroll = useRef(false);
  const lastTrigger = useRef<HTMLAnchorElement | null>(null);
  const previousPeek = useRef(peek);
  const returnUrl = `/${encodeURIComponent(slug)}/gallery/?${serializeGalleryViewState({ layout, query })}`;
  const canonicalSearch = serializeGalleryViewState({ layout, query, peek });
  useEffect(() => {
    if (searchParams.toString() !== canonicalSearch)
      navigate(
        {
          pathname: location.pathname,
          search: `?${canonicalSearch}`,
          hash: peek && location.hash === "#materials" ? "#materials" : "",
        },
        { replace: true, state: location.state }
      );
  }, [canonicalSearch, searchParams, navigate, location.state, location.pathname, location.hash, peek]);
  const loadGallery = useCallback(async () => {
    setLoading(true);
    setError(false);
    try {
      setData(await galleryService.getGallery(slug));
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
  const groups = useMemo(() => buildGalleryOverview(cards, query), [cards, query]);
  const visibleCards = groups.flatMap((group) => group.cards);
  useEffect(() => {
    if (loading || !data || restoredScroll.current) return;
    restoredScroll.current = true;
    try {
      const saved = window.sessionStorage.getItem(`gallery-scroll:${slug}`);
      window.sessionStorage.removeItem(`gallery-scroll:${slug}`);
      if (saved !== null)
        requestAnimationFrame(() => {
          if (scrollRef.current) scrollRef.current.scrollTop = Number(saved) || 0;
        });
    } catch {
      /* Browser storage may be disabled. */
    }
  }, [loading, data, slug]);
  useEffect(() => {
    if (previousPeek.current && !peek) {
      setPreview(undefined);
      requestAnimationFrame(() => lastTrigger.current?.focus({ preventScroll: true }));
    }
    previousPeek.current = peek;
  }, [peek]);
  const openDetail = (event: MouseEvent<HTMLAnchorElement>, card: GalleryCard) => {
    if (!shouldOpenGalleryPeek(event)) return;
    event.preventDefault();
    lastTrigger.current = event.currentTarget;
    setPreview(undefined);
    const hash = new URL(event.currentTarget.href).hash === "#materials" ? "#materials" : "";
    navigate(
      `/${encodeURIComponent(slug)}/gallery/?${serializeGalleryViewState({ layout, query, peek: card.id })}${hash}`,
      { replace: Boolean(peek), state: peek ? location.state : { galleryPeekFrom: returnUrl } }
    );
  };
  const closeDetail = useCallback(() => {
    if (location.state?.galleryPeekFrom === returnUrl) navigate(-1);
    else navigate(returnUrl, { replace: true, state: null });
  }, [navigate, location.state, returnUrl]);
  const setView = (next: { query: string; layout: GalleryLayout }) =>
    setSearchParams(serializeGalleryViewState(next), { replace: true, state: null });
  const detailHref = (card: GalleryCard) => getGalleryDetailHref(slug, card.id, returnUrl);
  const openAttachment = (attachment: GalleryAttachment) => {
    if (attachment.can_preview) setPreview(attachment);
    else window.open(attachment.file_url, "_blank", "noopener,noreferrer");
  };
  return (
    <div ref={scrollRef} className="h-full min-h-0 overflow-y-auto bg-surface-1 text-primary">
      <PageHead title="成果总览" />
      <Header variant={EHeaderVariant.TERNARY} setHeight={false} className="border-b border-subtle px-4 py-3 md:px-8">
        <div className="mx-auto flex w-full max-w-[1440px] flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <Images aria-hidden="true" className="size-5 text-accent-primary" />
            <h1 className="text-18 font-semibold">成果总览</h1>
            {data && <span className="text-12 text-secondary">{data.stats.total} 项成果</span>}
          </div>
          <div className="flex items-center gap-3">
            <Tabs value={layout} onValueChange={(value) => setView({ layout: value as GalleryLayout, query })}>
              <Tabs.List className="h-8 rounded-md border border-subtle-1 p-0.5">
                <Tabs.Trigger value="tree" className="flex h-7 items-center gap-1.5 rounded px-3 text-13">
                  <Network className="size-3.5" />
                  树状
                </Tabs.Trigger>
                <Tabs.Trigger value="sections" className="flex h-7 items-center gap-1.5 rounded px-3 text-13">
                  <LayoutGrid className="size-3.5" />
                  分区
                </Tabs.Trigger>
                <Tabs.Trigger value="cards" className="flex h-7 items-center gap-1.5 rounded px-3 text-13">
                  <Images className="size-3.5" />
                  卡片
                </Tabs.Trigger>
              </Tabs.List>
            </Tabs>
            {data?.can_create && (
              <a
                href={`/${encodeURIComponent(slug)}/gallery/manage/`}
                className="shrink-0 text-12 whitespace-nowrap text-secondary hover:text-link-primary"
              >
                管理成果
              </a>
            )}
          </div>
        </div>
      </Header>
      <main className="mx-auto max-w-[1440px] px-4 py-4 md:px-8">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <p className="text-13 text-secondary">按业务板块查看成果，点击查看详情。</p>
          <div className="relative w-full sm:w-64">
            <Search aria-hidden="true" className="absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-tertiary" />
            <Input
              aria-label="搜索成果"
              placeholder="搜索成果、工作项或材料"
              value={query}
              onChange={(event) => setView({ layout, query: event.target.value })}
              className="w-full pl-8"
            />
          </div>
        </div>
        {loading ? (
          <p role="status" className="py-12 text-center text-14 text-secondary">
            正在加载成果…
          </p>
        ) : error ? (
          <div role="alert" className="py-12 text-center">
            <p className="mb-3 text-14">暂时无法加载成果，请重试。</p>
            <Button onClick={() => void loadGallery()}>重新加载</Button>
          </div>
        ) : visibleCards.length ? (
          layout === "cards" ? (
            <GalleryCards
              cards={visibleCards}
              detailHref={detailHref}
              onOpenDetail={openDetail}
              onPreview={openAttachment}
            />
          ) : (
            <GalleryOverview groups={groups} layout={layout} detailHref={detailHref} onOpenDetail={openDetail} />
          )
        ) : (
          <div className="py-16 text-center">
            <p className="mb-3 text-14 text-secondary">{query ? "没有匹配的成果" : "暂无已发布成果"}</p>
            {query && (
              <Button variant="secondary" onClick={() => setView({ layout, query: "" })}>
                清空搜索
              </Button>
            )}
          </div>
        )}
      </main>
      {peek && (
        <ArtifactDetail
          key={peek}
          slug={slug}
          id={peek}
          returnHref={returnUrl}
          onClose={closeDetail}
          initialSection={location.hash === "#materials" ? "materials" : undefined}
        />
      )}
      {preview && (
        <AttachmentPreviewModal
          fileName={preview.name}
          fileURL={preview.file_url}
          onClose={() => setPreview(undefined)}
        />
      )}
    </div>
  );
}
