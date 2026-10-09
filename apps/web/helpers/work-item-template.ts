/** Preserve text and structured editor content when switching templates. */
export function hasTemplateDescriptionContent(html: string): boolean {
  if (
    html
      .replace(/<[^>]*>/g, "")
      .replace(/&nbsp;/g, " ")
      .trim()
  )
    return true;
  // An empty paragraph is the editor's initial value. Tables, media, embeds,
  // and mention nodes are meaningful even when their HTML has no plain text.
  return /<(?!\/?(?:p|div|span|br)\b)[a-z][^>]*>/i.test(html) || /\bdata-(?:type|id|entity|asset)[\w-]*=/i.test(html);
}
