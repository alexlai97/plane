import { useCallback, useMemo, useState } from "react";
import { TOAST_TYPE, setToast } from "@plane/propel/toast";
import { IS_FAVORITE_MENU_OPEN } from "@plane/constants";
import { useFavorite } from "@/hooks/store/use-favorite";
import { useWorkspace } from "@/hooks/store/use-workspace";
import { useUser } from "@/hooks/store/user";
import useLocalStorage from "@/hooks/use-local-storage";
import {
  createFavoritePayload,
  getFavoriteLabel,
  toggleEntityFavorite,
} from "@/components/favorites/entity-favorite-control-helpers";

export type UseEntityFavoriteProps = {
  workspaceSlug: string;
  entityType: string;
  entityId: string;
  projectId?: string;
  name?: string;
};

export const useEntityFavorite = ({ workspaceSlug, entityType, entityId, projectId, name }: UseEntityFavoriteProps) => {
  const favoriteStore = useFavorite();
  const { getWorkspaceBySlug } = useWorkspace();
  const { data: currentUser } = useUser();
  const { setValue: setFavoriteMenuOpen } = useLocalStorage<boolean>(IS_FAVORITE_MENU_OPEN, false);
  const workspaceId = getWorkspaceBySlug(workspaceSlug)?.id;
  const [localPending, setLocalPending] = useState(false);
  const isFavorite = favoriteStore.isFavorite(entityType, entityId, workspaceId);
  const pending = localPending || favoriteStore.isFavoritePending(entityType, entityId, workspaceId);
  const ready = Boolean(workspaceId && currentUser);
  const label = getFavoriteLabel(isFavorite);
  const favoritePayload = useMemo(
    () => createFavoritePayload({ entityType, entityId, projectId, workspaceId, name }),
    [entityType, entityId, projectId, workspaceId, name]
  );

  const toggle = useCallback(async () => {
    if (!ready || !workspaceSlug || !entityId || pending) return;
    setLocalPending(true);
    try {
      await toggleEntityFavorite({
        isFavorite,
        favoritePayload,
        addFavorite: (payload) => favoriteStore.addFavorite(workspaceSlug, payload),
        removeFavorite: () => favoriteStore.removeFavoriteEntity(workspaceSlug, entityId, entityType),
        onAdded: () => setFavoriteMenuOpen(true),
      });
    } catch (_error) {
      setToast({
        type: TOAST_TYPE.ERROR,
        title: "操作失败",
        message: "收藏状态更新失败，请稍后重试。",
      });
    } finally {
      setLocalPending(false);
    }
  }, [
    entityId,
    entityType,
    favoritePayload,
    favoriteStore,
    isFavorite,
    pending,
    ready,
    setFavoriteMenuOpen,
    workspaceSlug,
  ]);

  return { isFavorite, pending, toggle, label, ready };
};
