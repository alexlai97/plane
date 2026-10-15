import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildGalleryOverview,
  getGalleryResultIcon,
  getGallerySourceHref,
  parseGalleryViewState,
  resolveGalleryAction,
  sanitizeGalleryReturnUrl,
  serializeGalleryViewState,
} from "../../apps/web/core/helpers/gallery.ts";

const attachment = {
  id: "file-1",
  name: "操作演示.mp4",
  size: 1024,
  mime: "video/mp4",
  issue_id: "i1",
  file_url: "/api/assets/f1",
  source_url: "/api/assets/f1/source",
  can_preview: true,
};
const card = {
  id: "c1",
  category_id: "cat1",
  title: "机型资料录入工具",
  summary: "导入 BOM 表",
  category: "产品与研发",
  kind: "内网应用",
  updated_at: "2026-10-12T00:00:00Z",
  sources: [
    {
      id: "i1",
      sequence_id: 3,
      name: "机型资料录入",
      project_id: "p1",
      project_name: "项目",
      identifier: "AISTRAT-3",
      url: "/ai-strategy/browse/AISTRAT-3",
    },
  ],
  attachments: [attachment],
  links: [],
  cover: null,
  primary_action: { type: "attachment", label: "看演示", attachment_id: "file-1" },
};

test("unfiltered overview includes each result exactly once under its actual category", () => {
  const second = { ...card, id: "c2", category_id: "cat2", category: "新增业务板块", title: "新成果" };
  const third = { ...card, id: "c3" };
  const groups = buildGalleryOverview([card, second, third], "");
  assert.deepEqual(
    groups.map((g) => [g.id, g.name, g.cards.map((c) => c.id)]),
    [
      ["cat1", "产品与研发", ["c1", "c3"]],
      ["cat2", "新增业务板块", ["c2"]],
    ]
  );
  assert.equal(new Set(groups.flatMap((g) => g.cards.map((c) => c.id))).size, 3);
  assert.equal(buildGalleryOverview([], "").length, 0);
});

test("same-name distinct categories remain distinct; uncategorized results are retained", () => {
  const groups = buildGalleryOverview(
    [card, { ...card, id: "c2", category_id: "cat2" }, { ...card, id: "c3", category_id: null, category: "" }],
    ""
  );
  assert.equal(groups.length, 3);
  assert.equal(groups[2].name, "未分类");
});

test("search finds original titles, sources and materials without hiding category context", () => {
  assert.deepEqual(buildGalleryOverview([card], "AISTRAT-3")[0].cards, [card]);
  assert.deepEqual(buildGalleryOverview([card], "演示.mp4")[0].cards, [card]);
  assert.equal(buildGalleryOverview([card], "不存在").length, 0);
});

test("default is expanded tree; explicit sections round trips; old layouts map to sections", () => {
  assert.deepEqual(parseGalleryViewState(""), { query: "", layout: "tree" });
  assert.equal(parseGalleryViewState("layout=unknown").layout, "tree");
  for (const layout of ["gallery", "list", "sections"])
    assert.equal(parseGalleryViewState(`layout=${layout}`).layout, "sections");
  assert.equal(serializeGalleryViewState({ layout: "tree", query: "" }), "layout=tree");
  assert.deepEqual(parseGalleryViewState(serializeGalleryViewState({ layout: "sections", query: "BOM" })), {
    layout: "sections",
    query: "BOM",
  });
  assert.deepEqual(parseGalleryViewState("category=old&group=category&sort=title&layout=tree"), {
    layout: "tree",
    query: "",
  });
});

test("return URLs retain overview layout/search and reject cross-workspace/external paths", () => {
  assert.equal(
    sanitizeGalleryReturnUrl("/acme/gallery/?layout=sections&q=BOM&category=old", "acme"),
    "/acme/gallery/?q=BOM&layout=sections"
  );
  for (const url of ["https://attacker.example/acme/gallery/", "/other/gallery/", "/acme/gallery/manage/"])
    assert.equal(sanitizeGalleryReturnUrl(url, "acme"), "/acme/gallery/");
});

test("icons reflect primary material, never a hardcoded business title", () => {
  assert.equal(getGalleryResultIcon(card), "video");
  assert.equal(
    getGalleryResultIcon({ ...card, primary_action: { type: "link", label: "打开", url: "https://example.com" } }),
    "application"
  );
  assert.equal(
    getGalleryResultIcon({ ...card, attachments: [{ ...attachment, mime: "application/pdf" }] }),
    "document"
  );
  assert.equal(getGalleryResultIcon({ ...card, attachments: [{ ...attachment, mime: "image/png" }] }), "image");
});

test("primary actions preserve real attachment resolution and unsafe link fallback", () => {
  assert.deepEqual(resolveGalleryAction(card), { type: "attachment", attachment });
  assert.deepEqual(
    resolveGalleryAction({ ...card, primary_action: { type: "attachment", label: "查看", attachment_id: "missing" } }),
    { type: "detail" }
  );
  assert.deepEqual(
    resolveGalleryAction({ ...card, primary_action: { type: "link", label: "打开", url: "javascript:alert(1)" } }),
    { type: "detail" }
  );
  assert.equal(getGallerySourceHref("ai-strategy", card.sources[0]), "/ai-strategy/browse/AISTRAT-3");
});

test("tree layout keeps every leaf reachable and categories aligned without data-specific positions", async () => {
  const { layoutGalleryTree } = await import("../../apps/web/core/helpers/gallery.ts");
  const groups = buildGalleryOverview(
    [card, { ...card, id: "c2" }, { ...card, id: "c3", category_id: "cat2", category: "新板块" }],
    ""
  );
  const graph = layoutGalleryTree(groups, 900);
  assert.equal(graph.nodes.length, 6);
  assert.equal(graph.edges.length, 5);
  const leaves = graph.nodes.filter((n) => n.kind === "result");
  assert.equal(new Set(leaves.map((n) => n.card.id)).size, 3);
  assert.ok(leaves.every((n) => n.x + n.width <= 900 && n.y >= 0 && n.y + n.height <= graph.height));
  for (let i = 1; i < leaves.length; i++) assert.ok(leaves[i].y >= leaves[i - 1].y + leaves[i - 1].height);
  assert.equal(layoutGalleryTree([], 900).nodes.length, 0);
});

test("long category and result titles grow rather than overlap or escape a narrow tree", async () => {
  const { layoutGalleryTree } = await import("../../apps/web/core/helpers/gallery.ts");
  const groups = buildGalleryOverview(
    [{ ...card, category: "非常长的业务板块名称".repeat(5), title: "长成果名称".repeat(15) }],
    ""
  );
  const graph = layoutGalleryTree(groups, 640);
  const category = graph.nodes.find((n) => n.kind === "category");
  const leaf = graph.nodes.find((n) => n.kind === "result");
  assert.ok(category.height > 38);
  assert.ok(leaf.height > 32);
  for (const n of graph.nodes) {
    assert.ok(n.y >= 0);
    assert.ok(n.y + n.height <= graph.height);
    assert.ok(n.x + n.width <= 640);
  }
});
