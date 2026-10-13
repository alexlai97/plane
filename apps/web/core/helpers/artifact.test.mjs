import { test } from "node:test";
import assert from "node:assert/strict";
import { artifactToWrite, removeArtifactAsset, artifactError } from "./artifact.ts";
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
