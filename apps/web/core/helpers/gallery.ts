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
    if (category !== ALL_GALLERY_CATEGORY && card.category !== category) return false;
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
