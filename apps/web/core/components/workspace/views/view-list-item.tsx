import { observer } from "mobx-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { EntityFavoriteControl } from "@/components/favorites/entity-favorite-control";
import { useGlobalView } from "@/hooks/store/use-global-view";
import { WorkspaceViewQuickActions } from "./quick-action";

type Props = { viewId: string };

export const GlobalViewListItem = observer(function GlobalViewListItem({ viewId }: Props) {
  const { workspaceSlug } = useParams();
  const { getViewDetailsById } = useGlobalView();
  const view = getViewDetailsById(viewId);
  if (!view || !workspaceSlug) return null;
  const slug = workspaceSlug.toString();
  return (
    <div className="group flex min-h-[52px] items-center gap-3 border-b border-subtle px-4 hover:bg-surface-2">
      <Link href={`/${slug}/workspace-views/${view.id}`} className="min-w-0 flex-1 py-3">
        <p className="truncate text-13 font-medium">{view.name}</p>
        {view.description && <p className="truncate text-11 text-secondary">{view.description}</p>}
      </Link>
      <EntityFavoriteControl
        variant="icon"
        workspaceSlug={slug}
        entityType="workspace_view"
        entityId={view.id}
        name={view.name}
      />
      <WorkspaceViewQuickActions workspaceSlug={slug} view={view} />
    </div>
  );
});
