import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createPresentationId,
  presentationSlideIndex,
  presentationSlidesByChapter,
  selectPresentationImageUrl,
} from "./presentation-core.ts";

const slide = (id, title, body, media = []) => ({
  id,
  title,
  body,
  notes: "",
  issue_ids: [],
  media,
  links: [],
});

test("each horizontal chapter starts with its real summary slide", () => {
  const document = {
    schema_version: 1,
    sections: [
      {
        id: "one",
        title: "First chapter",
        slides: [
          slide("summary", "Summary", "Evidence on the first page"),
          slide("detail", "Details", "More evidence"),
        ],
      },
      { id: "two", title: "Second chapter", slides: [slide("other", "Next summary", "Next evidence")] },
    ],
  };
  const chapters = presentationSlidesByChapter(document);
  assert.equal(chapters.length, 2);
  assert.equal(chapters[0].slides[0].title, "Summary");
  assert.equal(chapters[0].slides[0].body, "Evidence on the first page");
  assert.equal(chapters[0].slides[1].title, "Details");
  assert.equal(chapters[1].slides[0].title, "Next summary");
  assert.deepEqual(presentationSlideIndex(document, 0, 0), { horizontal: 1, vertical: 0, total: 3 });
  assert.deepEqual(presentationSlideIndex(document, 1, 0), { horizontal: 3, vertical: 0, total: 3 });
});

test("derived previews and safe raster files can render inline, but viewer HTML and unsafe formats cannot", () => {
  const attachment = {
    asset_id: "asset-1",
    caption: "Evidence image",
    can_preview: true,
    file_url: "/assets/original",
    preview_url: "/assets/viewer.html",
    preview_file_url: "/assets/derived.png",
    filename: "source.pdf",
  };
  assert.equal(selectPresentationImageUrl(attachment), "/assets/derived.png");
  assert.equal(selectPresentationImageUrl({ ...attachment, preview_file_url: undefined }), undefined);
  assert.equal(
    selectPresentationImageUrl({ ...attachment, filename: "source.jpg", preview_file_url: undefined }),
    "/assets/original"
  );
  assert.equal(
    selectPresentationImageUrl({ ...attachment, mime_type: "image/svg+xml", preview_file_url: undefined }),
    undefined
  );
  assert.equal(selectPresentationImageUrl({ ...attachment, can_preview: false }), undefined);
});

test("generated document identifiers are UUIDs in browsers without secure-context crypto", () => {
  assert.match(createPresentationId(), /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
});
