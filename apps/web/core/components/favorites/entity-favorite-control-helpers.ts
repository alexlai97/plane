import type { IFavorite } from "@plane/types";

export type EntityFavoritePayloadInput = {
  entityType: string;
  entityId: string;
  projectId?: string;
  workspaceId?: string;
  name?: string;
};

export const getFavoriteLabel = (isFavorite: boolean) => (isFavorite ? "已收藏" : "收藏");

export const createFavoritePayload = ({
  entityType,
  entityId,
  projectId,
  workspaceId,
  name,
}: EntityFavoritePayloadInput): Partial<IFavorite> => ({
  entity_type: entityType,
  entity_identifier: entityId,
  name: name ?? "",
  entity_data: { name: name ?? "" },
  project_id: projectId ?? null,
  workspace_id: workspaceId,
});

type ToggleEntityFavoriteArgs = {
  isFavorite: boolean;
  favoritePayload: Partial<IFavorite>;
  addFavorite: (payload: Partial<IFavorite>) => Promise<unknown>;
  removeFavorite: () => Promise<unknown>;
  onAdded?: () => void;
};

export const toggleEntityFavorite = async ({
  isFavorite,
  favoritePayload,
  addFavorite,
  removeFavorite,
  onAdded,
}: ToggleEntityFavoriteArgs) => {
  if (isFavorite) {
    await removeFavorite();
    return "removed";
  }

  await addFavorite(favoritePayload);
  try {
    onAdded?.();
  } catch (_error) {
    // Opening the favorites section is secondary to the favorite mutation.
  }
  return "added";
};
