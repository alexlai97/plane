export type GallerySource = {
  id: string;
  sequence_id: number;
  name: string;
  project_id: string;
  project_name: string;
  identifier: string;
  url: string;
};

export type GalleryAttachment = {
  id: string;
  name: string;
  size: number;
  mime: string;
  issue_id: string;
  file_url: string;
  source_url: string;
  can_preview: boolean;
};

export type GalleryLink = {
  title: string;
  url: string;
  kind: "application" | "demo" | "reference";
  issue_id: string;
};

export type GalleryAction =
  | { type: "link"; label: string; url: string }
  | { type: "attachment"; label: string; attachment_id: string }
  | { type: "detail"; label: string; url?: never; attachment_id?: never };

export type GalleryCard = {
  id: string;
  category_id?: string | null;
  title: string;
  summary: string;
  category: string;
  kind: string;
  updated_at: string;
  sources: GallerySource[];
  attachments: GalleryAttachment[];
  links: GalleryLink[];
  cover: { source_url: string; file_url: string; name: string } | null;
  primary_action: GalleryAction;
};

export type GalleryResponse = {
  categories: string[];
  stats: { total: number; with_demo: number };
  cards: GalleryCard[];
};

export type GalleryActionTarget =
  | { type: "link"; url: string }
  | { type: "attachment"; attachment: GalleryAttachment }
  | { type: "detail" };

export const ALL_GALLERY_CATEGORY = "全部";

export function getGalleryCategoryCounts(cards: GalleryCard[], categories: string[]): Record<string, number> {
  return Object.fromEntries([
    [ALL_GALLERY_CATEGORY, cards.length],
    ...categories.map((category) => [category, cards.filter((card) => card.category === category).length]),
  ]);
}

export function filterGalleryCards(cards: GalleryCard[], category: string, query: string): GalleryCard[] {
  const normalizedQuery = query.trim().toLocaleLowerCase();
  return cards.filter((card) => {
    if (category !== ALL_GALLERY_CATEGORY && card.category !== category && card.category_id !== category) return false;
    if (!normalizedQuery) return true;
    const searchable = [
      card.title,
      card.summary,
      card.category,
      card.kind,
      ...card.sources.flatMap((source) => [source.identifier, source.name, source.project_name]),
      ...card.attachments.map((attachment) => attachment.name),
      ...card.links.map((link) => link.title),
    ]
      .join(" ")
      .toLocaleLowerCase();
    return searchable.includes(normalizedQuery);
  });
}

export type GalleryLayout = "gallery" | "list";
export type GallerySort = "curated" | "recent" | "title";
export type GalleryGroup = "none" | "category";
export type GalleryViewState = {
  category: string;
  query: string;
  layout: GalleryLayout;
  sort: GallerySort;
  group: GalleryGroup;
};

/** The gallery URL is the shareable source of truth; unknown parameters are discarded. */
export function parseGalleryViewState(
  search: string,
  categories: { id: string; name: string }[] = []
): GalleryViewState {
  const params = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  const rawCategory = params.get("category") ?? ALL_GALLERY_CATEGORY;
  const category =
    rawCategory === ALL_GALLERY_CATEGORY ||
    categories.length === 0 ||
    categories.some((item) => item.id === rawCategory)
      ? rawCategory
      : ALL_GALLERY_CATEGORY;
  const layout = params.get("layout");
  const sort = params.get("sort");
  const group = params.get("group");
  return {
    category,
    query: params.get("q") ?? "",
    layout: layout === "list" ? "list" : "gallery",
    sort: sort === "recent" || sort === "title" ? sort : "curated",
    group: group === "category" ? "category" : "none",
  };
}

export function serializeGalleryViewState(state: GalleryViewState): string {
  const params = new URLSearchParams();
  if (state.category !== ALL_GALLERY_CATEGORY) params.set("category", state.category);
  if (state.query) params.set("q", state.query);
  params.set("layout", state.layout);
  if (state.sort !== "curated") params.set("sort", state.sort);
  if (state.group !== "none") params.set("group", state.group);
  return params.toString();
}

export function sanitizeGalleryReturnUrl(value: string | null | undefined, workspaceSlug: string): string {
  const base = `/${encodeURIComponent(workspaceSlug)}/gallery/`;
  if (!value) return base;
  try {
    const candidate = new URL(value, "https://gallery.local");
    if (candidate.origin !== "https://gallery.local" || candidate.pathname !== base) return base;
    // Normalize enum values and retain only the gallery's shareable filter controls.
    const query = serializeGalleryViewState(parseGalleryViewState(candidate.search));
    return `${base}${query ? `?${query}` : ""}${candidate.hash === "#materials" ? "#materials" : ""}`;
  } catch {
    return base;
  }
}

export function orderGalleryCards(cards: GalleryCard[], sort: GallerySort): GalleryCard[] {
  if (sort === "curated") return [...cards];
  const ordered = [...cards];
  // oxlint-disable-next-line unicorn/no-array-sort -- Web target library predates Array#toSorted.
  return ordered.sort((a, b) => {
    if (sort === "title") return a.title.localeCompare(b.title, "zh-CN") || a.id.localeCompare(b.id);
    return (Date.parse(b.updated_at) || 0) - (Date.parse(a.updated_at) || 0) || a.id.localeCompare(b.id);
  });
}

export function groupGalleryCards(cards: GalleryCard[], group: GalleryGroup): { name: string; cards: GalleryCard[] }[] {
  if (group === "none") return [{ name: "", cards }];
  const names: string[] = [];
  const byName = new Map<string, GalleryCard[]>();
  for (const card of cards) {
    if (!byName.has(card.category)) {
      names.push(card.category);
      byName.set(card.category, []);
    }
    byName.get(card.category)?.push(card);
  }
  return names.map((name) => ({ name, cards: byName.get(name) ?? [] }));
}

export function resolveGalleryAction(card: GalleryCard): GalleryActionTarget {
  const action = card.primary_action;
  if (action.type === "detail") return { type: "detail" };
  if (action.type === "link") {
    return isSafeHttpUrl(action.url) ? { type: "link", url: action.url } : { type: "detail" };
  }
  const attachment = card.attachments.find((item) => item.id === action.attachment_id);
  return attachment ? { type: "attachment", attachment } : { type: "detail" };
}

export function isSafeHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

export function getGallerySourceHref(workspaceSlug: string, source: GallerySource): string {
  if (source.url.startsWith("/")) return source.url;
  return `/${workspaceSlug}/browse/${encodeURIComponent(source.identifier)}`;
}

/** Append the viewer path without dropping artifact view/revision authorization parameters. */
export function getAttachmentPreviewUrl(fileUrl: string): string {
  const url = new URL(fileUrl, "http://attachment.local");
  url.pathname = `${url.pathname.replace(/\/$/, "")}/preview/onlinePreview`;
  return fileUrl.startsWith("/") ? `${url.pathname}${url.search}${url.hash}` : url.toString();
}
