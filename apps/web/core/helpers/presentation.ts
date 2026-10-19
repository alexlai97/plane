import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ReactMarkdown from "react-markdown";
import { presentationSlidesByChapter, selectPresentationImageUrl } from "./presentation-core";
import type { PresentationDocument } from "./presentation-core";
export {
  createPresentationId,
  emptyPresentationDocument,
  presentationSlideIndex,
  selectPresentationImageUrl,
} from "./presentation-core";
export type {
  Presentation,
  PresentationDocument,
  PresentationLink,
  PresentationListItem,
  PresentationListResponse,
  PresentationMedia,
  PresentationSection,
  PresentationSlide,
} from "./presentation-core";

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => {
    const entities: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
    return entities[character];
  });
}

export function markdownToSafeHtml(markdown: string): string {
  return renderToStaticMarkup(
    createElement(ReactMarkdown, {
      skipHtml: true,
      urlTransform: (url: string) => (/^https?:\/\//i.test(url) ? url : ""),
      components: {
        img: () => null,
        a: ({ href, children }) =>
          href && /^https?:\/\//i.test(href)
            ? createElement("a", { href, target: "_blank", rel: "noopener noreferrer" }, children)
            : createElement("span", {}, children),
      },
      children: markdown,
    })
  );
}

export function buildRevealDocument(document: PresentationDocument, version: string): string {
  const sections = presentationSlidesByChapter(document)
    .map((section) => {
      const slides = section.slides
        .map((slide) => {
          const media = slide.media
            .map((item) => {
              const imageUrl = selectPresentationImageUrl(item);
              if (!imageUrl) return "";
              return `<figure><button type="button" class="media-preview" data-asset-id="${escapeHtml(item.asset_id)}" aria-label="查看原始附件"><img src="${escapeHtml(imageUrl)}" alt="${escapeHtml(item.caption || item.filename || "汇报配图")}"></button><figcaption>${escapeHtml(item.caption)}</figcaption></figure>`;
            })
            .join("");
          const links = slide.links
            .map((link) =>
              /^https?:\/\//i.test(link.url)
                ? `<p><a href="${escapeHtml(link.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(link.label || link.url)} ↗</a></p>`
                : ""
            )
            .join("");
          return `<section><p class="eyebrow">${escapeHtml(section.title)}</p><h2>${escapeHtml(slide.title)}</h2><div class="slide-layout${media ? " with-media" : ""}"><div class="copy"><div class="body">${markdownToSafeHtml(slide.body)}</div><div class="links">${links}</div></div>${media ? `<div class="evidence">${media}</div>` : ""}</div></section>`;
        })
        .join("");
      return `<section>${slides}</section>`;
    })
    .join("");
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/vendor/reveal/${version}/reset.css"><link rel="stylesheet" href="/vendor/reveal/${version}/reveal.css"><style>
html,body{height:100%;margin:0;background:#f8fafc}
.reveal{font:26px/1.5 Inter,system-ui,sans-serif;color:#243b53}
.reveal .slides{text-align:left}.reveal .slides>section.stack{padding:0}
.reveal .slides section:not(.stack){box-sizing:border-box;padding:36px 44px;height:100%;overflow:auto}
.reveal h2{color:#15344f;font-size:1.5em;font-weight:650;line-height:1.25;margin:0 0 28px;letter-spacing:-.025em}
.eyebrow{color:#51718c;letter-spacing:.04em;font-size:.62em;margin:0 0 10px}
.slide-layout{max-height:550px;overflow:auto}.slide-layout.with-media{display:grid;grid-template-columns:1.1fr 1fr;gap:36px;align-items:start}
.body p{margin:0 0 .8em}.body ul,.body ol{padding-left:1.2em;margin:.6em 0}.body li{margin:.4em 0}
.reveal figure{margin:0 0 16px}.reveal img{max-height:470px;max-width:100%;object-fit:contain;border-radius:10px}
.reveal figcaption{font-size:.62em;line-height:1.4;color:#627d98;margin-top:10px}
.reveal a{color:#306b99;text-decoration:underline}.links{font-size:.8em;margin-top:20px}.links p{margin:.5em 0}
.media-preview{cursor:zoom-in;border:1px solid #d9e2ec;border-radius:12px;background:#fff;padding:8px;max-width:100%}
.reveal .controls{color:#376f99}.reveal .progress{color:#376f99}
</style></head><body><div class="reveal"><div class="slides">${sections}</div></div><script src="/vendor/reveal/${version}/reveal.js"></script><script>
const hostOrigin=parent.location.origin;
Reveal.initialize({width:1280,height:760,margin:0.035,center:false,hash:false,controls:true,progress:true,slideNumber:'c/t',overview:true,transition:'slide',embedded:true,keyboard:{27:null}}).then(()=>{
 Reveal.on('slidechanged',event=>parent.postMessage({type:'bokang:presentation-slide',h:event.indexh,v:event.indexv},hostOrigin));
 document.addEventListener('click',event=>{const button=event.target.closest('[data-asset-id]');if(button)parent.postMessage({type:'bokang:presentation-media',assetId:button.dataset.assetId},hostOrigin)});
 parent.postMessage({type:'bokang:presentation-ready'},hostOrigin);
});
addEventListener('message',event=>{if(event.origin!==hostOrigin||event.source!==parent||event.data?.type!=='bokang:presentation-go')return;Reveal.slide(event.data.h,event.data.v)});
</script></body></html>`;
}
