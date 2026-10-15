export const favoriteServiceState = {
  addFavorite: async (_slug, data) => ({ ...data, id: `server-${Math.random()}` }),
  getFavorites: async () => [],
  getGroupedFavorites: async () => [],
  updateFavorite: async () => undefined,
  deleteFavorite: async () => undefined,
};

export class FavoriteService {
  addFavorite(...args) {
    return favoriteServiceState.addFavorite(...args);
  }
  getFavorites(...args) {
    return favoriteServiceState.getFavorites(...args);
  }
  getGroupedFavorites(...args) {
    return favoriteServiceState.getGroupedFavorites(...args);
  }
  updateFavorite(...args) {
    return favoriteServiceState.updateFavorite(...args);
  }
  deleteFavorite(...args) {
    return favoriteServiceState.deleteFavorite(...args);
  }
}
