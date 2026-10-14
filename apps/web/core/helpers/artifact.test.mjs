import { test } from "node:test";
import assert from "node:assert/strict";
import { artifactToWrite, removeArtifactAsset, artifactError, getArtifactShareUrl } from "./artifact.ts";
import { getAttachmentPreviewUrl } from "./gallery.ts";

const artifact = {
  title: "成果",
  summary: "已保存说明",
  kind: "工具",
  category_id: "category-one",
  source_issue_ids: ["issue-one", "issue-two"],
  assets: [{ id: "file-one", name: "封面.png", size: 20, type: "image/png" }],
  links: [{ title: "应用", url: "https://example.com", kind: "application", issue_id: "ignored" }],
  cover: { asset_id: "file-one" },
  primary_action: { type: "attachment", label: "打开材料", attachment_id: "file-one" },
  version: 7,
  owner_id: "read-only-owner",
  status: "published",
  can_edit: true,
};
test("edit payload carries current version and category id, without read-only metadata", () => {
  const form = artifactToWrite(artifact);
  assert.equal(form.version, 7);
  assert.equal(form.category_id, "category-one");
  assert.deepEqual(form.assets, [{ id: "file-one" }]);
  assert.deepEqual(form.links, [{ title: "应用", url: "https://example.com", kind: "application" }]);
  assert.equal(form.owner_id, undefined);
  assert.equal(form.status, undefined);
  assert.equal(artifactToWrite().version, undefined);
});

test("share URL removes gallery return context and marks a real draft view", () => {
  assert.equal(
    getArtifactShareUrl("https://plane.example/acme/gallery/a1/?from=%2Facme%2Fgallery%2F%3Fq%3Dx&view=draft", "draft"),
    "https://plane.example/acme/gallery/a1/?view=draft"
  );
  assert.equal(
    getArtifactShareUrl(
      "https://plane.example/acme/gallery/a1/?from=%2Facme%2Fgallery%2F%3Fq%3Dx&view=draft",
      "published"
    ),
    "https://plane.example/acme/gallery/a1/"
  );
});
test("removing material clears its cover and primary action without mutating local input", () => {
  const form = artifactToWrite(artifact);
  const next = removeArtifactAsset(form, "file-one");
  assert.deepEqual(next.assets, []);
  assert.equal(next.cover_asset_id, null);
  assert.deepEqual(next.primary_action, { type: "detail", label: "查看详情" });
  assert.equal(form.assets.length, 1);
  assert.equal(form.primary_action.type, "attachment");
  assert.equal(form.cover_asset_id, "file-one");
});
test("removing unrelated material retains selected cover and action", () => {
  const form = artifactToWrite(artifact);
  assert.deepEqual(removeArtifactAsset(form, "different"), form);
});
test("conflict error gives a local-retention instruction and permission errors remain explicit", () => {
  assert.match(artifactError({ response: { status: 409 } }), /本地输入已保留/);
  assert.match(artifactError({ response: { status: 403 } }), /没有访问权限/);
  assert.match(
    artifactError({ response: { status: 400, data: { title: ["名称必填"], links: "链接无效" } } }),
    /名称必填；链接无效/
  );
});

test("preview path retains draft and revision parameters after path insertion", () => {
  assert.equal(
    getAttachmentPreviewUrl("/api/artifacts/one/assets/file/?view=draft&revision=two"),
    "/api/artifacts/one/assets/file/preview/onlinePreview?view=draft&revision=two"
  );
  assert.equal(getAttachmentPreviewUrl("https://example.com/file/"), "https://example.com/file/preview/onlinePreview");
});

test("three-way merge preserves independent local and remote edits and uses newest version", async () => {
  const { mergeArtifactWrites } = await import("./artifact.ts");
  const base = artifactToWrite(artifact);
  const local = { ...base, title: "本地标题" };
  const latest = { ...base, summary: "其他成员说明", version: 9 };
  const result = mergeArtifactWrites(base, local, latest);
  assert.deepEqual(result.conflicts, []);
  assert.equal(result.merged.title, "本地标题");
  assert.equal(result.merged.summary, "其他成员说明");
  assert.equal(result.merged.version, 9);
  assert.equal(local.version, 7);
});
test("concurrent same-field changes require a side choice and equal edits need no choice", async () => {
  const { mergeArtifactWrites } = await import("./artifact.ts");
  const base = artifactToWrite(artifact);
  const local = { ...base, title: "本地标题", summary: "相同新说明" };
  const latest = { ...base, title: "其他成员标题", summary: "相同新说明", version: 8 };
  const pending = mergeArtifactWrites(base, local, latest);
  assert.deepEqual(pending.unresolved, ["title"]);
  assert.deepEqual(pending.conflicts, ["title"]);
  const chosen = mergeArtifactWrites(base, local, latest, { title: "latest" });
  assert.deepEqual(chosen.unresolved, []);
  assert.equal(chosen.merged.title, "其他成员标题");
  assert.equal(chosen.merged.summary, "相同新说明");
});
test("cover, primary target and button label, and link kind all participate in conflict resolution", async () => {
  const { mergeArtifactWrites } = await import("./artifact.ts");
  const base = artifactToWrite(artifact);
  const local = {
    ...base,
    cover_asset_id: "local-cover",
    primary_action: { type: "detail", label: "本地按钮" },
    links: [{ ...base.links[0], kind: "demo" }],
  };
  const latest = {
    ...base,
    cover_asset_id: "latest-cover",
    primary_action: { type: "link", label: "最新按钮", url: "https://example.com" },
    links: [{ ...base.links[0], kind: "reference" }],
    version: 10,
  };
  const pending = mergeArtifactWrites(base, local, latest);
  assert.deepEqual(pending.unresolved, ["links", "cover_asset_id", "primary_action"]);
  const partial = mergeArtifactWrites(base, local, latest, { links: "latest" });
  assert.deepEqual(partial.unresolved, ["cover_asset_id", "primary_action"]);
  const resolved = mergeArtifactWrites(base, local, latest, {
    links: "latest",
    cover_asset_id: "local",
    primary_action: "latest",
  });
  assert.deepEqual(resolved.unresolved, []);
  assert.equal(resolved.merged.links[0].kind, "reference");
  assert.equal(resolved.merged.cover_asset_id, "local-cover");
  assert.deepEqual(resolved.merged.primary_action, latest.primary_action);
});
test("remote untouched main action accepts local label even when object property order differs", async () => {
  const { mergeArtifactWrites } = await import("./artifact.ts");
  const base = artifactToWrite(artifact);
  const local = { ...base, primary_action: { ...base.primary_action, label: "新按钮" } };
  const latest = {
    ...base,
    primary_action: { attachment_id: "file-one", label: "打开材料", type: "attachment" },
    version: 8,
  };
  const result = mergeArtifactWrites(base, local, latest);
  assert.deepEqual(result.unresolved, []);
  assert.equal(result.merged.primary_action.label, "新按钮");
});
