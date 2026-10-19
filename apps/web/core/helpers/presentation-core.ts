import { v4 as uuidv4 } from "uuid";

export type PresentationLink = { label: string; url: string };
export type PresentationMedia = {
  asset_id: string;
  preview_asset_id?: string;
  caption: string;
  file_url?: string;
  preview_url?: string;
  preview_file_url?: string;
  mime_type?: string;
  filename?: string;
  can_preview?: boolean;
};
export type PresentationSlide = {
  id: string;
  title: string;
  body: string;
  notes: string;
  issue_ids: string[];
  media: PresentationMedia[];
  links: PresentationLink[];
};
export type PresentationSection = { id: string; title: string; slides: PresentationSlide[] };
export type PresentationDocument = { schema_version: 1; sections: PresentationSection[] };
export type Presentation = {
  id: string;
  title: string;
  project_id: string;
  version: number;
  published_revision_id: string | null;
  has_unpublished_changes: boolean;
  can_edit: boolean;
  document: PresentationDocument;
};
export type PresentationListItem = Omit<Presentation, "document"> & { updated_at?: string };
export type PresentationListResponse = { results: PresentationListItem[]; count: number; can_create: boolean };

export const emptyPresentationDocument = (): PresentationDocument => ({ schema_version: 1, sections: [] });
export const createPresentationId = () => uuidv4();

export function presentationSlideIndex(document: PresentationDocument, sectionIndex: number, slideIndex: number) {
  if (!document.sections[sectionIndex]) return { horizontal: 0, vertical: 0, total: 0 };
  return {
    horizontal:
      document.sections.slice(0, sectionIndex).reduce((sum, item) => sum + item.slides.length, 0) +
      Math.max(slideIndex, 0) +
      1,
    vertical: slideIndex,
    total: document.sections.reduce((sum, item) => sum + item.slides.length, 0),
  };
}

export function selectPresentationImageUrl(media: PresentationMedia): string | undefined {
  if (!media.can_preview) return undefined;
  if (media.preview_file_url) return media.preview_file_url;
  const safeRasterMimeTypes = new Set([
    "image/avif",
    "image/bmp",
    "image/gif",
    "image/jpeg",
    "image/png",
    "image/webp",
  ]);
  if (media.mime_type) return safeRasterMimeTypes.has(media.mime_type.toLowerCase()) ? media.file_url : undefined;
  const imageFile = [media.filename, media.file_url].some((candidate) => {
    if (!candidate) return false;
    try {
      const pathname = new URL(candidate, "https://local.invalid").pathname.toLowerCase();
      return /\.(avif|bmp|gif|jpe?g|png|webp)$/.test(pathname);
    } catch {
      return false;
    }
  });
  return imageFile ? media.file_url : undefined;
}

export function presentationSlidesByChapter(document: PresentationDocument) {
  return document.sections.map((section) => ({ title: section.title, slides: section.slides }));
}

/** Commands shared with the embedded viewer's existing Reveal navigation API. */
export function presentationKeyboardAction(event: {
  key: string;
  shiftKey?: boolean;
  ctrlKey?: boolean;
  metaKey?: boolean;
  altKey?: boolean;
}): "left" | "right" | "up" | "down" | "next" | "prev" | undefined {
  if (event.ctrlKey || event.metaKey || event.altKey) return undefined;
  switch (event.key) {
    case "ArrowLeft":
      return "left";
    case "ArrowRight":
      return "right";
    case "ArrowUp":
      return "up";
    case "ArrowDown":
      return "down";
    case "Enter":
      return "next";
    case " ":
      return event.shiftKey ? "prev" : "next";
    case "PageDown":
      return "next";
    case "PageUp":
      return "prev";
    default:
      return undefined;
  }
}
