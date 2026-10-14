import { useState } from "react";
import type { MouseEvent } from "react";
import { ArrowDownToLine, ArrowUpRight, Eye, FileText, Images, Link2 } from "lucide-react";
import { Button } from "@plane/propel/button";
import {
  getSafeGalleryLinks,
  type GalleryAttachment,
  type GalleryCard,
  type GalleryActionTarget,
} from "../../helpers/gallery";

export function GalleryCover({ card, compact = false }: { card: GalleryCard; compact?: boolean }) {
  const [failed, setFailed] = useState(false);
  return card.cover?.source_url && !failed ? (
    <img
      src={card.cover.source_url}
      alt=""
      className="h-full w-full bg-surface-2 object-contain"
      onError={() => setFailed(true)}
    />
  ) : compact ? (
    <div className="grid h-full w-full place-items-center text-tertiary">
      <Images className="size-5" />
    </div>
  ) : (
    <div className="mx-5 max-w-full rounded-lg border border-subtle bg-surface-1 px-4 py-3 text-center text-13 text-secondary">
      <span className="mb-1 block text-11 text-tertiary">{card.kind}</span>
      <span className="line-clamp-2">{failed ? "暂无预览图" : (card.attachments[0]?.name ?? card.summary)}</span>
    </div>
  );
}

function GalleryPrimaryAction({
  card,
  href,
  primary,
  openAttachment,
  onOpenDetail,
  compact = false,
}: {
  card: GalleryCard;
  href: string;
  primary: GalleryActionTarget;
  openAttachment: (item: GalleryAttachment) => void;
  onOpenDetail: (event: MouseEvent<HTMLAnchorElement>) => void;
  compact?: boolean;
}) {
  const externalDemo =
    primary.type === "link" && card.links.some((item) => item.kind === "demo" && item.url === primary.url);
  if (primary.type === "attachment")
    return (
      <Button
        size="lg"
        variant={compact ? "secondary" : "primary"}
        prependIcon={<FileText />}
        onClick={() => openAttachment(primary.attachment)}
      >
        {card.primary_action.label}
      </Button>
    );
  if (primary.type === "link")
    return (
      <a
        href={primary.url}
        target="_blank"
        rel="noopener noreferrer"
        title={externalDemo ? "链接可能需要对应外部平台的访问权限" : undefined}
        className={`inline-flex min-h-8 items-center gap-1.5 rounded-md px-3 text-12 font-medium ${compact ? "bg-accent-primary text-on-color" : "bg-accent-primary text-on-color hover:bg-accent-primary-hover"}`}
      >
        {card.primary_action.label}
        {externalDemo ? " · 外部" : ""}
        <ArrowUpRight className="size-3.5" />
      </a>
    );
  return compact ? (
    <a href={href} onClick={onOpenDetail} className="text-12 text-link-primary">
      {card.primary_action.label}
    </a>
  ) : (
    <a
      href={href}
      onClick={onOpenDetail}
      className="inline-flex min-h-8 items-center gap-1.5 rounded-md bg-accent-primary px-3 text-12 font-medium text-on-color hover:bg-accent-primary-hover"
    >
      {card.primary_action.label}
      <ArrowUpRight className="size-3.5" />
    </a>
  );
}

export function GalleryResult({
  card,
  href,
  attachmentHref,
  primary,
  openAttachment,
  onOpenDetail,
}: {
  card: GalleryCard;
  href: string;
  attachmentHref: (item: GalleryAttachment) => string;
  primary: GalleryActionTarget;
  openAttachment: (item: GalleryAttachment) => void;
  onOpenDetail: (event: MouseEvent<HTMLAnchorElement>) => void;
}) {
  const detail = (
    <a
      href={href}
      onClick={onOpenDetail}
      className="focus-visible:ring-accent-primary rounded-sm transition outline-none hover:text-link-primary focus-visible:text-link-primary focus-visible:ring-2"
    >
      {card.title}
    </a>
  );
  return (
    <article className="flex min-w-0 flex-col overflow-hidden rounded-lg border border-subtle bg-surface-1 shadow-raised-100">
      <a
        href={href}
        aria-label={`查看${card.title}详情`}
        onClick={onOpenDetail}
        className="group focus-visible:ring-accent-primary relative flex h-36 shrink-0 items-center justify-center overflow-hidden bg-surface-2 outline-none focus-visible:ring-2 focus-visible:ring-inset"
      >
        <GalleryCover card={card} />
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 flex items-center justify-center bg-accent-primary/0 text-on-color opacity-0 transition group-hover:bg-accent-primary/10 group-hover:opacity-100 group-focus-visible:bg-accent-primary/10 group-focus-visible:opacity-100"
        >
          <Eye className="size-5 drop-shadow" />
        </span>
      </a>
      <div className="flex min-h-[15rem] flex-1 flex-col p-4">
        <div className="flex flex-wrap gap-1.5 text-11 text-tertiary">
          <span className="rounded bg-layer-2 px-2 py-1">{card.category}</span>
          <span className="rounded bg-layer-2 px-2 py-1">{card.kind}</span>
        </div>
        <h3 className="mt-3 line-clamp-2 min-h-12 text-16 font-semibold text-primary">{detail}</h3>
        <p className="mt-2 line-clamp-2 min-h-10 text-13 leading-5 text-secondary">{card.summary}</p>
        <div className="mt-3 min-h-8" id={`materials-${card.id}`}>
          {card.attachments.length > 0 && (
            <div className="flex min-w-0 flex-wrap gap-x-3 gap-y-1 text-11">
              {card.attachments.slice(0, 2).map((item) => (
                <a
                  key={item.id}
                  href={attachmentHref(item)}
                  onClick={(event) => {
                    if (item.can_preview) {
                      event.preventDefault();
                      openAttachment(item);
                    }
                  }}
                  className="inline-flex max-w-full items-center gap-1 truncate text-link-primary hover:underline"
                >
                  {item.can_preview ? (
                    <FileText className="size-3.5 shrink-0" />
                  ) : (
                    <ArrowDownToLine className="size-3.5 shrink-0" />
                  )}
                  {item.name}
                </a>
              ))}
              {card.attachments.length > 2 && (
                <a href={`${href}#materials`} className="text-secondary hover:text-link-primary hover:underline">
                  另有 {card.attachments.length - 2} 项
                </a>
              )}
            </div>
          )}
        </div>
        <div className="mt-auto flex items-center justify-between gap-2 border-t border-subtle pt-3">
          <GalleryPrimaryAction
            card={card}
            href={href}
            primary={primary}
            openAttachment={openAttachment}
            onOpenDetail={onOpenDetail}
          />
          <a href={href} onClick={onOpenDetail} className="shrink-0 text-12 text-link-primary hover:underline">
            详情
          </a>
        </div>
      </div>
    </article>
  );
}

export function GalleryListRow({
  card,
  href,
  primary,
  openAttachment,
  onOpenDetail,
}: {
  card: GalleryCard;
  href: string;
  primary: GalleryActionTarget;
  openAttachment: (item: GalleryAttachment) => void;
  onOpenDetail: (event: MouseEvent<HTMLAnchorElement>) => void;
}) {
  return (
    <article className="flex min-w-0 flex-wrap items-center gap-4 border-b border-subtle px-4 py-3 last:border-b-0">
      <a
        href={href}
        onClick={onOpenDetail}
        className="flex size-14 shrink-0 items-center justify-center overflow-hidden rounded border border-subtle bg-surface-2"
        aria-label={`查看${card.title}详情`}
      >
        <GalleryCover card={card} compact />
      </a>
      <div className="min-w-0 flex-1 basis-56">
        <h3 className="truncate text-14 font-semibold text-primary">
          <a href={href} onClick={onOpenDetail} className="hover:text-link-primary">
            {card.title}
          </a>
        </h3>
        <p className="mt-1 truncate text-12 text-secondary">{card.summary}</p>
        <p className="mt-1 text-11 text-tertiary">
          {card.category} · {card.kind}
        </p>
      </div>
      <div className="flex min-w-0 flex-wrap gap-2">
        {card.attachments.slice(0, 2).map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => openAttachment(item)}
            className="inline-flex max-w-48 items-center gap-1 truncate text-11 text-link-primary hover:underline"
          >
            {item.can_preview ? (
              <Eye className="size-3.5 shrink-0" />
            ) : (
              <ArrowDownToLine className="size-3.5 shrink-0" />
            )}
            {item.name}
          </button>
        ))}
        {getSafeGalleryLinks(card.links)
          .slice(0, 1)
          .map((item) => (
            <a
              key={item.url}
              href={item.url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex max-w-40 items-center gap-1 truncate text-11 text-link-primary hover:underline"
            >
              <Link2 className="size-3.5" />
              {item.title}
            </a>
          ))}
      </div>
      <GalleryPrimaryAction
        card={card}
        href={href}
        primary={primary}
        openAttachment={openAttachment}
        onOpenDetail={onOpenDetail}
        compact
      />
    </article>
  );
}
