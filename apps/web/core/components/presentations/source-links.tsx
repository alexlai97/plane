import { ExternalLink } from "lucide-react";
import type { PresentationSource } from "../../helpers/presentation";

export function PresentationSourceLinks({ ids, sources = [] }: { ids: string[]; sources?: PresentationSource[] }) {
  const byId = new Map(sources.map((source) => [source.id, source]));
  return (
    <nav aria-label="本页相关工作项" className="flex max-h-24 flex-wrap gap-2 overflow-y-auto">
      {[...new Set(ids)].map((id) => {
        const source = byId.get(id);
        const label = source?.is_available
          ? `${source.identifier} · ${source.context ? `${source.context} / ` : ""}${source.name}`
          : source
            ? "原工作项已不可用或暂无查看权限"
            : "保存后显示关联工作项";
        return source?.is_available && source.url ? (
          <a
            key={id}
            href={source.url}
            target="_blank"
            rel="noopener noreferrer"
            title={label}
            className="inline-flex max-w-96 items-center gap-1.5 rounded-md border border-subtle-1 bg-surface-1 px-2 py-1 text-12 text-link-primary hover:bg-surface-2"
          >
            <span className="min-w-0">
              <span className="block truncate">
                {source.identifier} · {source.name}
                {source.is_archived ? "（已归档）" : ""}
              </span>
              {source.context && <span className="block truncate text-11 text-tertiary">{source.context}</span>}
            </span>
            <ExternalLink className="size-3 shrink-0" />
          </a>
        ) : (
          <span key={id} className="rounded-md bg-surface-2 px-2 py-1 text-12 text-tertiary">
            {label}
          </span>
        );
      })}
    </nav>
  );
}
