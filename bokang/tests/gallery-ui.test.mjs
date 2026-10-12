import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ALL_GALLERY_CATEGORY,
  filterGalleryCards,
  getGalleryCategoryCounts,
  getGallerySourceHref,
  resolveGalleryAction,
} from "../../apps/web/core/helpers/gallery.ts";

const attachment = {
  id: "file-1",
  name: "操作演示.mp4",
  size: 1024,
  mime: "video/mp4",
  issue_id: "issue-1",
  file_url: "/api/assets/file-1",
  source_url: "/api/assets/file-1/preview/source",
  can_preview: true,
};
const card = {
  id: "gallery-1",
  title: "机型资料录入工具",
  summary: "导入 BOM 表，辅助录入机型资料。",
  category: "产品与研发",
  kind: "内网应用",
  updated_at: "2026-10-12T00:00:00Z",
  sources: [
    {
      id: "issue-1",
      sequence_id: 3,
      name: "机型资料录入",
      project_id: "p1",
      project_name: "AI战略部项目",
      identifier: "AISTRAT-3",
      url: "/ai-strategy/browse/AISTRAT-3",
    },
  ],
  attachments: [attachment],
  links: [],
  cover: null,
  primary_action: { type: "attachment", label: "看演示", attachment_id: "file-1" },
};

test("gallery counts use unique cards and report category totals", () => {
  assert.deepEqual(getGalleryCategoryCounts([card], ["产品与研发", "生产与质量"]), {
    [ALL_GALLERY_CATEGORY]: 1,
    产品与研发: 1,
    生产与质量: 0,
  });
});

test("search finds source identifiers and attachment names, category narrows results", () => {
  assert.deepEqual(filterGalleryCards([card], ALL_GALLERY_CATEGORY, "AISTRAT-3"), [card]);
  assert.deepEqual(filterGalleryCards([card], ALL_GALLERY_CATEGORY, "演示.mp4"), [card]);
  assert.deepEqual(filterGalleryCards([card], "生产与质量", ""), []);
});

test("primary action resolves only a real linked attachment and falls back to detail", () => {
  assert.deepEqual(resolveGalleryAction(card), { type: "attachment", attachment });
  assert.deepEqual(
    resolveGalleryAction({
      ...card,
      primary_action: { type: "attachment", label: "看演示", attachment_id: "missing" },
    }),
    { type: "detail" }
  );
  assert.deepEqual(
    resolveGalleryAction({ ...card, primary_action: { type: "link", label: "打开", url: "javascript:alert(1)" } }),
    { type: "detail" }
  );
  assert.deepEqual(resolveGalleryAction({ ...card, primary_action: { type: "detail", label: "查看详情" } }), {
    type: "detail",
  });
});

test("source links prefer the server route and otherwise use the workspace browse route", () => {
  assert.equal(getGallerySourceHref("ai-strategy", card.sources[0]), "/ai-strategy/browse/AISTRAT-3");
  assert.equal(getGallerySourceHref("ai-strategy", { ...card.sources[0], url: "" }), "/ai-strategy/browse/AISTRAT-3");
});
