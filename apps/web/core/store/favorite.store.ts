/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { orderBy, set } from "lodash-es";
import { action, observable, makeObservable, runInAction, computed } from "mobx";
import { v4 as uuidv4 } from "uuid";
import type { IFavorite } from "@plane/types";
import { FavoriteService } from "@/services/favorite";
import type { CoreRootStore } from "./root.store";

export interface IFavoriteStore {
  // observables
  favoriteIds: string[];
  favoriteMap: {
    [favoriteId: string]: IFavorite;
  };
  entityMap: {
    [entityId: string]: IFavorite;
  };
  favoritePendingKeys: string[];
  // computed actions
  existingFolders: string[];
  groupedFavorites: { [favoriteId: string]: IFavorite };
  // actions
  fetchFavorite: (workspaceSlug: string) => Promise<IFavorite[]>;
  // CRUD actions
  addFavorite: (workspaceSlug: string, data: Partial<IFavorite>) => Promise<IFavorite>;
  updateFavorite: (workspaceSlug: string, favoriteId: string, data: Partial<IFavorite>) => Promise<IFavorite>;
  deleteFavorite: (workspaceSlug: string, favoriteId: string) => Promise<void>;
  fetchGroupedFavorites: (workspaceSlug: string, favoriteId: string) => Promise<IFavorite[]>;
  moveFavoriteToFolder: (workspaceSlug: string, favoriteId: string, data: Partial<IFavorite>) => Promise<void>;
  removeFavoriteEntity: (workspaceSlug: string, entityId: string, entityType?: string) => Promise<void>;
  reOrderFavorite: (
    workspaceSlug: string,
    favoriteId: string,
    destinationId: string,
    edge: string | undefined
  ) => Promise<void>;
  removeFromFavoriteFolder: (workspaceSlug: string, favoriteId: string) => Promise<void>;
  removeFavoriteFromStore: (entity_identifier: string) => void;
  getFavorite: (entityType: string, entityId: string, workspaceId?: string) => IFavorite | undefined;
  isFavorite: (entityType: string, entityId: string, workspaceId?: string) => boolean;
  isFavoritePending: (entityType: string, entityId: string, workspaceId?: string) => boolean;
}

const favoriteEntityKey = (workspaceId: string, entityType: string, entityId: string) =>
  `${workspaceId}:${entityType}:${entityId}`;

export class FavoriteStore implements IFavoriteStore {
  // observables
  favoriteIds: string[] = [];
  favoriteMap: {
    [favoriteId: string]: IFavorite;
  } = {};
  entityMap: {
    [entityId: string]: IFavorite;
  } = {};
  favoritePendingKeys: string[] = [];
  private favoriteAddRequests = new Map<string, Promise<IFavorite>>();
  private favoriteRevisions = new Map<string, number>();
  private favoriteFetchTokens = new Map<string, number>();
  private groupedFavoriteFetchTokens = new Map<string, number>();
  // service
  favoriteService;
  rootStore;
  viewStore;
  projectStore;
  pageStore;
  cycleStore;
  moduleStore;

  constructor(_rootStore: CoreRootStore) {
    makeObservable(this, {
      // observable
      favoriteMap: observable,
      entityMap: observable,
      favoriteIds: observable,
      favoritePendingKeys: observable,
      //computed
      currentWorkspaceFavorites: computed,
      existingFolders: computed,
      groupedFavorites: computed,
      // action
      fetchFavorite: action,
      // CRUD actions
      addFavorite: action,
      fetchGroupedFavorites: action,
      moveFavoriteToFolder: action,
      removeFavoriteEntity: action,
      reOrderFavorite: action,
      removeFavoriteEntityFromStore: action,
      removeFromFavoriteFolder: action,
    });
    this.favoriteService = new FavoriteService();
    this.rootStore = _rootStore;
    this.viewStore = _rootStore.projectView;
    this.projectStore = _rootStore.projectRoot.project;
    this.moduleStore = _rootStore.module;
    this.cycleStore = _rootStore.cycle;
    this.pageStore = _rootStore.projectPages;
  }

  private workspaceId(workspaceId?: string) {
    return workspaceId ?? this.rootStore.workspaceRoot.currentWorkspace?.id ?? "";
  }

  private markFavoritesChanged(workspaceId: string) {
    if (!workspaceId) return;
    this.favoriteRevisions.set(workspaceId, (this.favoriteRevisions.get(workspaceId) ?? 0) + 1);
  }

  private nextFetchToken(tokens: Map<string, number>, key: string) {
    const token = (tokens.get(key) ?? 0) + 1;
    tokens.set(key, token);
    return token;
  }

  getFavorite = (entityType: string, entityId: string, workspaceId?: string) => {
    const workspace = this.workspaceId(workspaceId);
    if (!workspace || !entityId) return undefined;
    const exactKey = favoriteEntityKey(workspace, entityType, entityId);
    const direct = this.entityMap[exactKey];
    if (direct) return direct;
    return Object.values(this.favoriteMap).find(
      (favorite) =>
        favorite.workspace_id === workspace &&
        favorite.entity_type === entityType &&
        favorite.entity_identifier === entityId
    );
  };

  isFavorite = (entityType: string, entityId: string, workspaceId?: string) =>
    Boolean(this.getFavorite(entityType, entityId, workspaceId));

  isFavoritePending = (entityType: string, entityId: string, workspaceId?: string) => {
    const workspace = this.workspaceId(workspaceId);
    return Boolean(workspace && this.favoritePendingKeys.includes(favoriteEntityKey(workspace, entityType, entityId)));
  };

  private indexFavorite(favorite: IFavorite) {
    if (!favorite.entity_identifier) return;
    const key = favoriteEntityKey(favorite.workspace_id, favorite.entity_type, favorite.entity_identifier);
    set(this.entityMap, [key], favorite);
    // Keep the old unscoped key for existing project/page/cycle/view stores.
    if (["project", "page", "cycle", "module", "view"].includes(favorite.entity_type)) {
      set(this.entityMap, [favorite.entity_identifier], favorite);
    }
  }

  private unindexFavorite(favorite: IFavorite) {
    if (!favorite.entity_identifier) return;
    const key = favoriteEntityKey(favorite.workspace_id, favorite.entity_type, favorite.entity_identifier);
    if (this.entityMap[key]?.id === favorite.id) delete this.entityMap[key];
    if (this.entityMap[favorite.entity_identifier]?.id === favorite.id)
      delete this.entityMap[favorite.entity_identifier];
  }

  get currentWorkspaceFavorites() {
    const currentWorkspace = this.rootStore.workspaceRoot.currentWorkspace;
    if (!currentWorkspace) return {};
    return Object.values(this.favoriteMap)
      .filter((fav: IFavorite) => fav.workspace_id === currentWorkspace.id)
      .reduce(
        (acc, fav) => {
          acc[fav.id] = fav;
          return acc;
        },
        {} as { [favoriteId: string]: IFavorite }
      );
  }

  get existingFolders() {
    return Object.values(this.currentWorkspaceFavorites).map((favorite) => favorite.name);
  }

  get groupedFavorites() {
    const data: { [favoriteId: string]: IFavorite } = JSON.parse(JSON.stringify(this.currentWorkspaceFavorites));

    Object.values(data).forEach((fav) => {
      if (fav.parent && data[fav.parent]) {
        if (data[fav.parent].children) {
          if (!data[fav.parent].children.some((f) => f.id === fav.id)) {
            data[fav.parent].children.push(fav);
          }
        } else {
          data[fav.parent].children = [fav];
        }
      }
    });
    return data;
  }

  /**
   * Creates a favorite in the workspace and adds it to the store
   * @param workspaceSlug
   * @param data
   * @returns Promise<IFavorite>
   */
  addFavorite = async (workspaceSlug: string, data: Partial<IFavorite>) => {
    data = {
      ...data,
      workspace_id: data.workspace_id ?? this.rootStore.workspaceRoot.currentWorkspace?.id,
      parent: null,
      is_folder: data.entity_type === "folder",
    };
    const workspaceId = data.workspace_id ?? "";
    const entityKey =
      data.entity_identifier && data.entity_type && workspaceId
        ? favoriteEntityKey(workspaceId, data.entity_type, data.entity_identifier)
        : undefined;
    if (entityKey && this.favoriteAddRequests.has(entityKey)) return this.favoriteAddRequests.get(entityKey)!;
    if (entityKey && this.entityMap[entityKey]) return this.entityMap[entityKey];
    const id = uuidv4();
    const request = (async () => {
      try {
        this.markFavoritesChanged(workspaceId);
        // optimistic addition
        runInAction(() => {
          const optimisticFavorite = { ...data, id } as IFavorite;
          set(this.favoriteMap, [id], optimisticFavorite);
          this.indexFavorite(optimisticFavorite);
          this.favoriteIds = [id, ...this.favoriteIds];
          if (entityKey) this.favoritePendingKeys = [...this.favoritePendingKeys, entityKey];
        });
        const response = await this.favoriteService.addFavorite(workspaceSlug, data);

        // overwrite the temp id
        runInAction(() => {
          delete this.favoriteMap[id];
          set(this.favoriteMap, [response.id], response);
          this.indexFavorite(response);
          this.favoriteIds = [response.id, ...this.favoriteIds.filter((favId) => favId !== id)];
        });
        return response;
      } catch (error) {
        runInAction(() => {
          delete this.favoriteMap[id];
          const optimisticFavorite = { ...data, id } as IFavorite;
          this.unindexFavorite(optimisticFavorite);
          this.favoriteIds = this.favoriteIds.filter((favId) => favId !== id);
        });

        console.error("Failed to create favorite from favorite store");
        throw error;
      } finally {
        if (entityKey) {
          runInAction(() => {
            this.favoritePendingKeys = this.favoritePendingKeys.filter((key) => key !== entityKey);
          });
          this.favoriteAddRequests.delete(entityKey);
        }
      }
    })();
    if (entityKey) this.favoriteAddRequests.set(entityKey, request);
    return request;
  };

  /**
   * Updates a favorite in the workspace and updates the store
   * @param workspaceSlug
   * @param favoriteId
   * @param data
   * @returns Promise<IFavorite>
   */
  updateFavorite = async (workspaceSlug: string, favoriteId: string, data: Partial<IFavorite>) => {
    const initialState = this.favoriteMap[favoriteId];
    if (initialState) this.markFavoritesChanged(initialState.workspace_id);
    try {
      runInAction(() => {
        set(this.favoriteMap, [favoriteId], { ...this.favoriteMap[favoriteId], ...data });
      });
      const response = await this.favoriteService.updateFavorite(workspaceSlug, favoriteId, data);

      return response;
    } catch (error) {
      console.error("Failed to update favorite from favorite store");
      runInAction(() => {
        set(this.favoriteMap, [favoriteId], initialState);
      });
      throw error;
    }
  };

  /**
   * Moves a favorite in the workspace and updates the store
   * @param workspaceSlug
   * @param favoriteId
   * @param data
   * @returns Promise<void>
   */
  moveFavoriteToFolder = async (workspaceSlug: string, favoriteId: string, data: Partial<IFavorite>) => {
    try {
      const workspaceId = this.favoriteMap[favoriteId]?.workspace_id;
      if (workspaceId) this.markFavoritesChanged(workspaceId);
      await this.favoriteService.updateFavorite(workspaceSlug, favoriteId, data);
      runInAction(() => {
        // add parent of the favorite
        set(this.favoriteMap, [favoriteId, "parent"], data.parent);
      });
    } catch (error) {
      console.error("Failed to move favorite to folder", error);
      throw error;
    }
  };

  reOrderFavorite = async (
    workspaceSlug: string,
    favoriteId: string,
    destinationId: string,
    edge: string | undefined
  ) => {
    try {
      const workspaceId = this.favoriteMap[favoriteId]?.workspace_id;
      if (workspaceId) this.markFavoritesChanged(workspaceId);
      let resultSequence = 10000;
      if (edge) {
        const sortedIds = orderBy(Object.values(this.currentWorkspaceFavorites), "sequence", "desc").map(
          (favorite: IFavorite) => favorite.id
        );
        const destinationSequence = this.favoriteMap[destinationId]?.sequence || undefined;
        if (destinationSequence) {
          const destinationIndex = sortedIds.findIndex((id) => id === destinationId);
          if (edge === "reorder-above") {
            const prevSequence = this.favoriteMap[sortedIds[destinationIndex - 1]]?.sequence || undefined;
            if (prevSequence) {
              resultSequence = (destinationSequence + prevSequence) / 2;
            } else {
              resultSequence = destinationSequence + resultSequence;
            }
          } else {
            resultSequence = destinationSequence - resultSequence;
          }
        }
      }

      await this.favoriteService.updateFavorite(workspaceSlug, favoriteId, { sequence: resultSequence });

      runInAction(() => {
        set(this.favoriteMap, [favoriteId, "sequence"], resultSequence);
      });
    } catch (error) {
      console.error("Failed to move favorite folder");
      throw error;
    }
  };

  removeFromFavoriteFolder = async (workspaceSlug: string, favoriteId: string) => {
    try {
      const workspaceId = this.favoriteMap[favoriteId]?.workspace_id;
      if (workspaceId) this.markFavoritesChanged(workspaceId);
      await this.favoriteService.updateFavorite(workspaceSlug, favoriteId, { parent: null });
      runInAction(() => {
        //remove parent
        set(this.favoriteMap, [favoriteId, "parent"], null);
      });
    } catch (error) {
      console.error("Failed to move favorite");
      throw error;
    }
  };

  removeFavoriteEntityFromStore = (entity_identifier: string, entity_type: string) => {
    switch (entity_type) {
      case "view":
        return (
          this.viewStore.viewMap[entity_identifier] && (this.viewStore.viewMap[entity_identifier].is_favorite = false)
        );
      case "module":
        return (
          this.moduleStore.moduleMap[entity_identifier] &&
          (this.moduleStore.moduleMap[entity_identifier].is_favorite = false)
        );
      case "page":
        return this.pageStore.data[entity_identifier] && (this.pageStore.data[entity_identifier].is_favorite = false);
      case "cycle":
        return (
          this.cycleStore.cycleMap[entity_identifier] &&
          (this.cycleStore.cycleMap[entity_identifier].is_favorite = false)
        );
      case "project":
        return (
          this.projectStore.projectMap[entity_identifier] &&
          (this.projectStore.projectMap[entity_identifier].is_favorite = false)
        );
      default:
        return;
    }
  };

  /**
   * Deletes a favorite from the workspace and updates the store
   * @param workspaceSlug
   * @param favoriteId
   * @returns Promise<void>
   */
  deleteFavorite = async (workspaceSlug: string, favoriteId: string) => {
    if (!this.favoriteMap[favoriteId]) return;
    const initialState = this.favoriteMap[favoriteId];
    const deletedFavorites: IFavorite[] = [initialState];
    if (initialState.is_folder) {
      const descendants = Object.values(this.favoriteMap).filter(
        (favorite) => favorite.workspace_id === initialState.workspace_id
      );
      const pendingParents = new Set([initialState.id]);
      while (pendingParents.size) {
        const next = descendants.filter((favorite) => favorite.parent && pendingParents.has(favorite.parent));
        next.forEach((favorite) => {
          pendingParents.delete(favorite.parent!);
          pendingParents.add(favorite.id);
          if (!deletedFavorites.some((item) => item.id === favorite.id)) deletedFavorites.push(favorite);
        });
        if (!next.length) break;
      }
    }
    const pendingKeys = deletedFavorites
      .filter((favorite) => favorite.entity_identifier)
      .map((favorite) => favoriteEntityKey(favorite.workspace_id, favorite.entity_type, favorite.entity_identifier!));
    runInAction(() => {
      this.favoritePendingKeys = [...new Set([...this.favoritePendingKeys, ...pendingKeys])];
    });

    try {
      this.markFavoritesChanged(initialState.workspace_id);
      await this.favoriteService.deleteFavorite(workspaceSlug, favoriteId);
      runInAction(() => {
        deletedFavorites.forEach((favorite) => {
          delete this.favoriteMap[favorite.id];
          this.unindexFavorite(favorite);
          if (favorite.entity_identifier) {
            this.removeFavoriteEntityFromStore(favorite.entity_identifier, favorite.entity_type);
          }
        });
        const deletedIds = new Set(deletedFavorites.map((favorite) => favorite.id));
        this.favoriteIds = this.favoriteIds.filter((id) => !deletedIds.has(id));
      });
    } catch (error) {
      console.error("Failed to delete favorite from favorite store", error);
      throw error;
    } finally {
      if (pendingKeys.length) {
        runInAction(() => {
          const pending = new Set(pendingKeys);
          this.favoritePendingKeys = this.favoritePendingKeys.filter((key) => !pending.has(key));
        });
      }
    }
  };

  /**
   * Removes a favorite entity from the workspace and updates the store
   * @param workspaceSlug
   * @param entityId
   * @returns Promise<void>
   */
  removeFavoriteEntity = async (workspaceSlug: string, entityId: string, entityType?: string) => {
    const workspaceId = this.workspaceId();
    const initialState = entityType
      ? this.getFavorite(entityType, entityId)
      : ((this.entityMap[entityId]?.workspace_id === workspaceId ? this.entityMap[entityId] : undefined) ??
        Object.values(this.favoriteMap).find(
          (favorite) => favorite.workspace_id === workspaceId && favorite.entity_identifier === entityId
        ));
    if (!initialState) return;
    try {
      const favoriteId = initialState.id;
      await this.deleteFavorite(workspaceSlug, favoriteId);
    } catch (error) {
      console.error("Failed to remove favorite entity from favorite store", error);
      throw error;
    }
  };

  removeFavoriteFromStore = (entity_identifier: string) => {
    try {
      const workspaceId = this.workspaceId();
      const oldData =
        (this.entityMap[entity_identifier]?.workspace_id === workspaceId
          ? this.entityMap[entity_identifier]
          : undefined) ??
        Object.values(this.favoriteMap).find(
          (favorite) => favorite.workspace_id === workspaceId && favorite.entity_identifier === entity_identifier
        );
      const projectData = Object.values(this.favoriteMap).filter(
        (favorite) =>
          favorite.workspace_id === workspaceId &&
          favorite.project_id === entity_identifier &&
          favorite.entity_type !== "project"
      );
      const toRemove = [oldData, ...projectData].filter((favorite): favorite is IFavorite => Boolean(favorite));
      toRemove.forEach((favorite) => this.markFavoritesChanged(favorite.workspace_id));
      runInAction(() => {
        const removeIds = new Set(toRemove.map((favorite) => favorite.id));
        toRemove.forEach((favorite) => {
          delete this.favoriteMap[favorite.id];
          this.unindexFavorite(favorite);
          if (favorite.entity_identifier) {
            this.removeFavoriteEntityFromStore(favorite.entity_identifier, favorite.entity_type);
          }
        });
        this.favoriteIds = this.favoriteIds.filter((id) => !removeIds.has(id));
      });
    } catch (error) {
      console.error("Failed to remove favorite from favorite store", error);
      throw error;
    }
  };
  /**
   * get Grouped Favorites
   * @param workspaceSlug
   * @param favoriteId
   * @returns Promise<IFavorite[]>
   */
  fetchGroupedFavorites = async (workspaceSlug: string, favoriteId: string) => {
    if (!favoriteId) return [];
    const workspaceId = this.favoriteMap[favoriteId]?.workspace_id ?? this.workspaceId();
    const fetchKey = favoriteEntityKey(workspaceId, "folder", favoriteId);
    const fetchToken = this.nextFetchToken(this.groupedFavoriteFetchTokens, fetchKey);
    const revision = this.favoriteRevisions.get(workspaceId) ?? 0;
    try {
      const response = await this.favoriteService.getGroupedFavorites(workspaceSlug, favoriteId);
      if (
        this.groupedFavoriteFetchTokens.get(fetchKey) !== fetchToken ||
        (this.favoriteRevisions.get(workspaceId) ?? 0) !== revision ||
        !this.favoriteMap[favoriteId]
      )
        return response;
      runInAction(() => {
        const responseIds = new Set(response.map((favorite) => favorite.id));
        const existingChildren = Object.values(this.favoriteMap).filter(
          (favorite) =>
            favorite.parent === favoriteId && favorite.workspace_id === this.favoriteMap[favoriteId]?.workspace_id
        );
        existingChildren.forEach((favorite) => {
          if (responseIds.has(favorite.id)) return;
          delete this.favoriteMap[favorite.id];
          this.unindexFavorite(favorite);
          this.favoriteIds = this.favoriteIds.filter((id) => id !== favorite.id);
        });
        response.forEach((favorite) => {
          set(this.favoriteMap, [favorite.id], favorite);
          if (!this.favoriteIds.includes(favorite.id)) this.favoriteIds.push(favorite.id);
          this.indexFavorite(favorite);
        });
      });

      return response;
    } catch (error) {
      console.error("Failed to get grouped favorites from favorite store");
      throw error;
    }
  };

  /**
   * get Workspace favorite using workspace slug
   * @param workspaceSlug
   * @returns Promise<IFavorite[]>
   *
   */
  fetchFavorite = async (workspaceSlug: string) => {
    const requestedWorkspaceId = this.workspaceId();
    const fetchKey = requestedWorkspaceId || `slug:${workspaceSlug}`;
    const fetchToken = this.nextFetchToken(this.favoriteFetchTokens, fetchKey);
    const revision = requestedWorkspaceId ? (this.favoriteRevisions.get(requestedWorkspaceId) ?? 0) : 0;
    try {
      const favorites = await this.favoriteService.getFavorites(workspaceSlug);
      const workspaceId = favorites[0]?.workspace_id ?? requestedWorkspaceId;
      if (
        this.favoriteFetchTokens.get(fetchKey) !== fetchToken ||
        (workspaceId && (this.favoriteRevisions.get(workspaceId) ?? 0) !== revision)
      )
        return favorites;
      runInAction(() => {
        const responseIds = new Set(favorites.map((favorite) => favorite.id));
        Object.values(this.favoriteMap)
          .filter((favorite) => favorite.workspace_id === workspaceId && !responseIds.has(favorite.id))
          .forEach((favorite) => {
            delete this.favoriteMap[favorite.id];
            this.unindexFavorite(favorite);
            this.favoriteIds = this.favoriteIds.filter((id) => id !== favorite.id);
          });
        favorites.forEach((favorite) => {
          set(this.favoriteMap, [favorite.id], favorite);
          if (!this.favoriteIds.includes(favorite.id)) this.favoriteIds.push(favorite.id);
          this.indexFavorite(favorite);
        });
      });
      return favorites;
    } catch (error) {
      console.error("Failed to fetch favorites from workspace store");
      throw error;
    }
  };
}
