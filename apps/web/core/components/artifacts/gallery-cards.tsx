import { ArtifactAssignees } from "./assignees";
import { useState } from "react";
import { ArrowUpRight, Eye, FileText, Images } from "lucide-react";
import { Card, ECardSpacing, ECardVariant } from "@plane/propel/card";
import { Button } from "@plane/propel/button";
import { resolveGalleryAction, shouldOpenGalleryPeek } from "../../helpers/gallery";
import type { GalleryAttachment, GalleryCard } from "../../helpers/gallery";
import type { GalleryDetailLinkHandler } from "./gallery-overview";

function ResultCard({
  card,
  href,
  onOpenDetail,
  onPreview,
}: {
  card: GalleryCard;
  href: string;
  onOpenDetail: GalleryDetailLinkHandler;
  onPreview: (attachment: GalleryAttachment) => void;
}) {
  const [failedCover, setFailedCover] = useState(false);
  const action = resolveGalleryAction(card);
  return (
    <Card
      role="article"
      aria-label={card.title}
      variant={ECardVariant.WITHOUT_SHADOW}
      spacing={ECardSpacing.SM}
      className="h-full min-w-0 gap-0 space-y-0 overflow-hidden p-0"
    >
      <a
        href={href}
        aria-label={`查看${card.title}详情`}
        onClick={(event) => onOpenDetail(event, card)}
        className="group focus-visible:ring-accent-primary relative flex h-40 shrink-0 items-center justify-center bg-surface-2 outline-none focus-visible:ring-2 focus-visible:ring-inset"
      >
        {card.cover && !failedCover ? (
          <img
            src={card.cover.source_url}
            alt=""
            loading="lazy"
            onError={() => setFailedCover(true)}
            className="size-full object-contain"
          />
        ) : (
          <div className="flex flex-col items-center gap-2 p-5 text-center text-13 text-secondary">
            <Images aria-hidden="true" className="size-6" />
            <span>{card.kind}</span>
          </div>
        )}
        <span
          aria-hidden="true"
          className="absolute inset-0 grid place-items-center bg-black/0 text-white opacity-0 transition group-hover:bg-black/10 group-hover:opacity-100 group-focus-visible:bg-black/10 group-focus-visible:opacity-100"
        >
          <Eye className="size-6" />
        </span>
      </a>
      <div className="flex flex-1 flex-col gap-3 p-4">
        <div className="flex flex-wrap gap-2 text-11 text-secondary">
          <span>{card.category || "未分类"}</span>
          <span>·</span>
          <span>{card.kind}</span>
        </div>
        <h2 className="text-16 font-semibold">
          <a
            href={href}
            onClick={(event) => onOpenDetail(event, card)}
            className="focus-visible:ring-accent-primary rounded text-primary outline-none hover:text-link-primary focus-visible:ring-2"
          >
            {card.title}
          </a>
        </h2>
        <ArtifactAssignees ids={card.assignee_ids} showNames />
        <p className="line-clamp-2 min-h-10 text-13 leading-5 text-secondary">{card.summary}</p>
        <div className="flex min-h-8 flex-wrap gap-x-3 gap-y-1 text-12">
          {card.attachments.slice(0, 2).map((item) => (
            <a
              key={item.id}
              href={item.file_url}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(event) => {
                if (item.can_preview && shouldOpenGalleryPeek(event)) {
                  event.preventDefault();
                  onPreview(item);
                }
              }}
              className="inline-flex max-w-full items-center gap-1 text-link-primary hover:underline"
            >
              <FileText aria-hidden="true" className="size-3.5 shrink-0" />
              <span className="truncate">{item.name}</span>
            </a>
          ))}
          {card.attachments.length > 2 && (
            <a
              href={`${href}#materials`}
              onClick={(event) => onOpenDetail(event, card)}
              className="text-link-primary hover:underline"
            >
              另有 {card.attachments.length - 2} 项
            </a>
          )}
        </div>
        <div className="mt-auto flex items-center justify-between gap-3 border-t border-subtle pt-3">
          {action.type === "attachment" ? (
            <Button size="lg" variant="secondary" prependIcon={<Eye />} onClick={() => onPreview(action.attachment)}>
              {card.primary_action.label}
            </Button>
          ) : action.type === "link" ? (
            <a
              href={action.url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 rounded-md bg-accent-primary px-3 py-2 text-12 text-on-color"
            >
              {card.primary_action.label}
              <ArrowUpRight aria-hidden="true" className="size-3.5" />
            </a>
          ) : (
            <a href={href} onClick={(event) => onOpenDetail(event, card)} className="text-12 text-link-primary">
              {card.primary_action.label}
            </a>
          )}
          <a
            href={href}
            onClick={(event) => onOpenDetail(event, card)}
            className="shrink-0 text-12 text-link-primary hover:underline"
          >
            详情
          </a>
        </div>
      </div>
    </Card>
  );
}
export function GalleryCards({
  cards,
  detailHref,
  onOpenDetail,
  onPreview,
}: {
  cards: GalleryCard[];
  detailHref: (card: GalleryCard) => string;
  onOpenDetail: GalleryDetailLinkHandler;
  onPreview: (attachment: GalleryAttachment) => void;
}) {
  return (
    <div aria-label="卡片成果总览" className="grid grid-cols-1 items-stretch gap-4 md:grid-cols-2 xl:grid-cols-3">
      {cards.map((card) => (
        <ResultCard
          key={card.id}
          card={card}
          href={detailHref(card)}
          onOpenDetail={onOpenDetail}
          onPreview={onPreview}
        />
      ))}
    </div>
  );
}
