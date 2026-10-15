export type GallerySource = {
  id: string;
  sequence_id: number;
  assignee_ids?: string[];
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
  assignee_ids?: string[];
  sources: GallerySource[];
  attachments: GalleryAttachment[];
  links: GalleryLink[];
  cover: { source_url: string; file_url: string; name: string } | null;
  primary_action: GalleryAction;
};

export type GalleryResponse = {
  can_create: boolean;
  categories: string[];
  stats: { total: number; with_demo: number };
  cards: GalleryCard[];
};

export type GalleryActionTarget =
  | { type: "link"; url: string }
  | { type: "attachment"; attachment: GalleryAttachment }
  | { type: "detail" };

export type GalleryLayout = "tree" | "sections" | "cards";
export type GalleryViewState = { query: string; layout: GalleryLayout; peek?: string };
export type GalleryOverviewGroup = { id: string; name: string; cards: GalleryCard[] };

/** One canonical result per category; no category-name or workspace-specific presentation rules. */
export function buildGalleryOverview(cards: GalleryCard[], query: string): GalleryOverviewGroup[] {
  const groups = new Map<string, GalleryOverviewGroup>();
  const normalized = query.trim().toLocaleLowerCase();
  for (const card of cards) {
    const searchable = [
      card.title,
      card.summary,
      card.category,
      card.kind,
      ...card.sources.flatMap((source) => [source.identifier, source.name, source.project_name]),
      ...card.attachments.map((item) => item.name),
      ...card.links.map((item) => item.title),
    ]
      .join(" ")
      .toLocaleLowerCase();
    if (normalized && !searchable.includes(normalized)) continue;
    const name = card.category || "未分类";
    const id = card.category_id || `name:${name}`;
    if (!groups.has(id)) groups.set(id, { id, name, cards: [] });
    groups.get(id)!.cards.push(card);
  }
  return [...groups.values()];
}

export function parseGalleryViewState(search: string): GalleryViewState {
  const params = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  const layout = params.get("layout");
  const peek = params.get("peekArtifact") ?? "";
  return {
    query: params.get("q") ?? "",
    layout:
      layout === "cards" || layout === "gallery"
        ? "cards"
        : layout === "sections" || layout === "list"
          ? "sections"
          : "tree",
    ...(/^[a-zA-Z0-9_-]{1,100}$/.test(peek) ? { peek } : {}),
  };
}

export function serializeGalleryViewState(state: GalleryViewState): string {
  const params = new URLSearchParams();
  if (state.query) params.set("q", state.query);
  params.set("layout", state.layout);
  if (state.peek && /^[a-zA-Z0-9_-]{1,100}$/.test(state.peek)) params.set("peekArtifact", state.peek);
  return params.toString();
}

export function sanitizeGalleryReturnUrl(value: string | null | undefined, workspaceSlug: string): string {
  const base = `/${encodeURIComponent(workspaceSlug)}/gallery/`;
  if (!value) return base;
  try {
    const candidate = new URL(value, "https://gallery.local");
    if (candidate.origin !== "https://gallery.local" || candidate.pathname !== base) return base;
    const { layout, query: search } = parseGalleryViewState(candidate.search);
    const query = serializeGalleryViewState({ layout, query: search });
    return `${base}?${query}`;
  } catch {
    return base;
  }
}

export function getGalleryResultIcon(card: GalleryCard): "application" | "video" | "audio" | "image" | "document" {
  const action = resolveGalleryAction(card);
  if (action.type === "link") return "application";
  const mime = (action.type === "attachment" ? action.attachment : card.attachments[0])?.mime ?? "";
  if (mime.startsWith("video/")) return "video";
  if (mime.startsWith("audio/")) return "audio";
  if (mime.startsWith("image/")) return "image";
  return "document";
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
    return (url.protocol === "http:" || url.protocol === "https:") && Boolean(url.hostname);
  } catch {
    return false;
  }
}

export function getSafeGalleryLinks<T extends { url: string }>(links: T[]): T[] {
  return links.filter((link) => isSafeHttpUrl(link.url));
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

export type GalleryTreeNode = {
  id: string;
  kind: "root" | "category" | "result";
  title: string;
  x: number;
  y: number;
  width: number;
  height: number;
  count?: number;
  card?: GalleryCard;
};

/** The three-column overview is fixed, read-only and grows with content rather than shrinking labels. */
export function layoutGalleryTree(
  groups: GalleryOverviewGroup[],
  width: number
): {
  nodes: GalleryTreeNode[];
  edges: { id: string; source: string; target: string }[];
  height: number;
} {
  if (!groups.length) return { nodes: [], edges: [], height: 0 };
  const nodes: GalleryTreeNode[] = [];
  const edges: { id: string; source: string; target: string }[] = [];
  const compact = width < 800;
  const categoryX = compact ? 120 : 160;
  const categoryWidth = compact ? 150 : 190;
  const resultX = categoryX + categoryWidth + 44;
  const resultWidth = Math.max(160, width - resultX - 4);
  let y = 4;
  for (const group of groups) {
    const start = y;
    const categoryLabelWidth = Array.from(group.name).reduce(
      (sum, char) => sum + (char.charCodeAt(0) > 255 ? 14 : 8),
      0
    );
    const categoryHeight = Math.max(38, Math.ceil(categoryLabelWidth / (categoryWidth - 60)) * 20 + 12);
    const leaves: GalleryTreeNode[] = [];
    for (const card of group.cards) {
      // Conservative width budget preserves wrapped titles, including narrow canvases and long names.
      const labelWidth = Array.from(card.title).reduce((sum, char) => sum + (char.charCodeAt(0) > 255 ? 14 : 8), 0);
      const height = Math.max(32, Math.ceil(labelWidth / Math.max(80, resultWidth - 64)) * 20 + 12);
      const node: GalleryTreeNode = {
        id: `result:${card.id}`,
        kind: "result",
        title: card.title,
        card,
        x: resultX,
        y,
        width: resultWidth,
        height,
      };
      nodes.push(node);
      leaves.push(node);
      y += height + 2;
    }
    const groupHeight = Math.max(categoryHeight, 40, y - start - 2);
    const categoryId = `category:${group.id}`;
    nodes.push({
      id: categoryId,
      kind: "category",
      title: group.name,
      count: group.cards.length,
      x: categoryX,
      y: start + (groupHeight - categoryHeight) / 2,
      width: categoryWidth,
      height: categoryHeight,
    });
    edges.push({ id: `root:${categoryId}`, source: "root", target: categoryId });
    for (const leaf of leaves) edges.push({ id: `${categoryId}:${leaf.id}`, source: categoryId, target: leaf.id });
    y = start + groupHeight + 10;
  }
  const height = Math.max(84, y - 6);
  nodes.unshift({
    id: "root",
    kind: "root",
    title: "成果与应用",
    count: groups.reduce((count, g) => count + g.cards.length, 0),
    x: 0,
    y: (height - 76) / 2,
    width: compact ? 90 : 112,
    height: 76,
  });
  return { nodes, edges, height };
}

export function shouldOpenGalleryPeek(event: {
  button: number;
  defaultPrevented: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
}): boolean {
  return (
    event.button === 0 &&
    !event.defaultPrevented &&
    !event.ctrlKey &&
    !event.metaKey &&
    !event.shiftKey &&
    !event.altKey
  );
}

export function getGalleryDetailHref(slug: string, id: string, returnHref?: string): string {
  const base = `/${encodeURIComponent(slug)}/gallery/${encodeURIComponent(id)}/`;
  return returnHref ? `${base}?from=${encodeURIComponent(sanitizeGalleryReturnUrl(returnHref, slug))}` : base;
}
