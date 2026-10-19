import assert from "node:assert/strict";
import { test } from "node:test";
import { buildRevealDocument, markdownToSafeHtml } from "./presentation";

test("report bold labels render with standard Markdown while code and escaped delimiters remain literal", () => {
  assert.match(markdownToSafeHtml("**任务状态：已完成。** 10/15记录"), /<strong>任务状态：已完成。<\/strong> 10\/15记录/);
  assert.match(markdownToSafeHtml("`**示例**`"), /<code>\*\*示例\*\*<\/code>/);
  assert.doesNotMatch(markdownToSafeHtml("\\*\\*普通文本\\*\\*"), /<strong>/);
  assert.doesNotMatch(markdownToSafeHtml('<script>alert(1)</script>'), /<script>/);
});

test("the fullscreen iframe includes every accessible attachment, including files without image previews", () => {
  const html = buildRevealDocument({schema_version: 1, sections: [{id: "section", title: "章节", slides: [{id: "slide", title: "任务", body: "正文", notes: "", issue_ids: [], links: [], media: [
    {asset_id: "markdown", caption: "需求 <文档>", filename: "requirements.md", file_url: "/file/md", can_preview: true},
    {asset_id: "pdf", caption: "材料", filename: "source.pdf", file_url: "/file/pdf", can_preview: true},
    {asset_id: "hidden", caption: "不可访问", filename: "private.pdf", file_url: "/file/private", can_preview: false},
  ]}]}]}, "5.2.1");
  assert.match(html, /\.body strong\{font-weight:700\}/);
  assert.match(html, /aria-label="本页附件"/);
  assert.match(html, /class="attachment-action" data-asset-id="markdown"/);
  assert.match(html, /class="attachment-action" data-asset-id="pdf"/);
  assert.match(html, /需求 &lt;文档&gt;/);
  assert.doesNotMatch(html, /data-asset-id="hidden"/);
});
