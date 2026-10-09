import { test } from "node:test";
import assert from "node:assert/strict";
import { hasTemplateDescriptionContent } from "../../apps/web/helpers/work-item-template.ts";

test("empty initial editor paragraphs permit the default template", () => {
  for (const html of ["", "<p></p>", "<p><br></p>", "<div><p>&nbsp;</p></div>"])
    assert.equal(hasTemplateDescriptionContent(html), false);
});
test("text, tables, media-only, and mention-only descriptions require a choice", () => {
  for (const html of [
    "我的需求",
    "<p>交付物</p>",
    "<table><tr><td></td></tr></table>",
    '<img src="/asset">',
    '<image-component asset-id="x"></image-component>',
    '<mention-component id="user"></mention-component>',
    '<span data-type="mention"></span>',
  ])
    assert.equal(hasTemplateDescriptionContent(html), true);
});
