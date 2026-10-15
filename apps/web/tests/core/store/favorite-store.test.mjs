import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";
import path from "node:path";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer } from "vite";

const appRoot = path.resolve(import.meta.dirname, "../../..");
const testRoot = path.dirname(import.meta.filename);
let vite;
let FavoriteStore;
let favoriteServiceState;
let FAVORITE_ITEM_LINKS;
let parseGalleryViewState;
let ArtifactFavoritePeekProvider;
let getArtifactPeekFocusTarget;

before(async () => {
  vite = await createServer({
    configFile: false,
    root: appRoot,
    server: { middlewareMode: true },
    ssr: { external: ["react", "react-dom"] },
    appType: "custom",
    resolve: {
      alias: [
        { find: "@/services/favorite", replacement: `${testRoot}/favorite-service-stub.mjs` },
        { find: /^@\/(.*)$/, replacement: `${appRoot}/core/$1` },
      ],
    },
  });
  ({ FavoriteStore } = await vite.ssrLoadModule("/core/store/favorite.store.ts"));
  ({ FAVORITE_ITEM_LINKS } = await vite.ssrLoadModule("@plane/constants"));
  ({ parseGalleryViewState } = await vite.ssrLoadModule("/core/helpers/gallery.ts"));
  ({ ArtifactFavoritePeekProvider, getArtifactPeekFocusTarget } = await vite.ssrLoadModule(
    "/core/components/workspace/sidebar/favorites/artifact-peek-provider.tsx"
  ));
  ({ favoriteServiceState } = await vite.ssrLoadModule("/tests/core/store/favorite-service-stub.mjs"));
});

after(async () => vite?.close());

beforeEach(() => {
  favoriteServiceState.addFavorite = async (_slug, data) => ({
    ...data,
    id: `server-${data.workspace_id}-${data.entity_identifier}`,
  });
  favoriteServiceState.getFavorites = async () => [];
  favoriteServiceState.getGroupedFavorites = async () => [];
  favoriteServiceState.updateFavorite = async () => undefined;
  favoriteServiceState.deleteFavorite = async () => undefined;
});

function makeStore(workspaceId = "workspace-1") {
  const rootStore = {
    workspaceRoot: { currentWorkspace: { id: workspaceId } },
    projectRoot: { project: { projectMap: {} } },
    projectView: { viewMap: {} },
    module: { moduleMap: {} },
    cycle: { cycleMap: {} },
    projectPages: { data: {} },
  };
  return new FavoriteStore(rootStore);
}

function favorite({
  id,
  workspace_id = "workspace-1",
  entity_type = "issue",
  entity_identifier,
  parent = null,
  is_folder = false,
}) {
  return {
    id,
    workspace_id,
    name: id,
    entity_type,
    entity_identifier,
    entity_data: { id: entity_identifier, name: id },
    is_available: true,
    is_folder,
    sort_order: 1,
    parent,
    children: [],
    project_id: null,
    sequence: 1,
  };
}

test("favorite entity identity includes workspace and entity type", async () => {
  const store = makeStore();
  favoriteServiceState.addFavorite = async (slug, data) => ({ ...data, id: `${slug}-saved` });

  const first = await store.addFavorite("one", {
    workspace_id: "workspace-1",
    entity_type: "issue",
    entity_identifier: "shared-id",
  });
  const second = await store.addFavorite("two", {
    workspace_id: "workspace-2",
    entity_type: "issue",
    entity_identifier: "shared-id",
  });
  const third = await store.addFavorite("two", {
    workspace_id: "workspace-2",
    entity_type: "artifact",
    entity_identifier: "shared-id",
  });

  assert.equal(store.getFavorite("issue", "shared-id", "workspace-1").id, first.id);
  assert.equal(store.getFavorite("issue", "shared-id", "workspace-2").id, second.id);
  assert.equal(store.getFavorite("artifact", "shared-id", "workspace-2").id, third.id);
});

test("artifact favorite canonical link selects the artifact using the gallery route parser", () => {
  const artifact = favorite({ id: "favorite-artifact", entity_type: "artifact", entity_identifier: "artifact-123" });
  const href = FAVORITE_ITEM_LINKS.artifact.getLink(artifact);
  const url = new URL(href, "https://gallery.example");

  assert.deepEqual(parseGalleryViewState(url.search), { query: "", layout: "tree", peek: "artifact-123" });
});

test("artifact peek host is a stable sibling of the removable favorite rows", () => {
  const markup = renderToStaticMarkup(
    React.createElement(
      ArtifactFavoritePeekProvider,
      { workspaceSlug: "workspace" },
      React.createElement("section", { "data-testid": "favorite-rows" })
    )
  );
  const rowsIndex = markup.indexOf('data-testid="favorite-rows"');
  const hostIndex = markup.indexOf('data-testid="artifact-favorite-peek-host"');

  assert.notEqual(rowsIndex, -1);
  assert.notEqual(hostIndex, -1);
  assert.ok(rowsIndex < hostIndex);
});

test("artifact peek returns focus to its row or the favorites toggle when the row was removed", () => {
  const liveTrigger = { isConnected: true };
  const removedTrigger = { isConnected: false };
  const favoritesToggle = { isConnected: true };

  assert.equal(getArtifactPeekFocusTarget(liveTrigger, favoritesToggle), liveTrigger);
  assert.equal(getArtifactPeekFocusTarget(removedTrigger, favoritesToggle), favoritesToggle);
});

test("concurrent duplicate adds make one request and return the same favorite", async () => {
  const store = makeStore();
  let calls = 0;
  favoriteServiceState.addFavorite = async (_slug, data) => {
    calls += 1;
    await new Promise((resolve) => setTimeout(resolve, 5));
    return { ...data, id: "server-issue" };
  };
  const data = { workspace_id: "workspace-1", entity_type: "issue", entity_identifier: "issue-1" };

  const [first, second] = await Promise.all([store.addFavorite("one", data), store.addFavorite("one", data)]);

  assert.equal(calls, 1);
  assert.equal(first.id, second.id);
  assert.equal(Object.keys(store.currentWorkspaceFavorites).length, 1);
});

test("failed removal leaves one indexed favorite and clears shared pending state", async () => {
  const store = makeStore();
  const saved = favorite({ id: "fav-1", entity_type: "artifact", entity_identifier: "artifact-1" });
  favoriteServiceState.getFavorites = async () => [saved];
  favoriteServiceState.deleteFavorite = async () => {
    throw new Error("delete failed");
  };
  await store.fetchFavorite("one");

  await assert.rejects(store.removeFavoriteEntity("one", "artifact-1", "artifact"));

  assert.equal(store.getFavorite("artifact", "artifact-1").id, saved.id);
  assert.equal(store.favoriteIds.filter((id) => id === saved.id).length, 1);
  assert.equal(store.isFavoritePending("artifact", "artifact-1"), false);
});

test("deleting a folder clears all indexed descendants", async () => {
  const store = makeStore();
  const root = favorite({ id: "folder", is_folder: true, entity_type: "folder" });
  const child = favorite({ id: "child", entity_type: "issue", entity_identifier: "issue-1", parent: root.id });
  const grandchild = favorite({
    id: "grandchild",
    entity_type: "artifact",
    entity_identifier: "artifact-1",
    parent: child.id,
  });
  favoriteServiceState.getFavorites = async () => [root, child, grandchild];
  await store.fetchFavorite("one");

  await store.deleteFavorite("one", root.id);

  assert.equal(store.favoriteMap[root.id], undefined);
  assert.equal(store.getFavorite("issue", "issue-1"), undefined);
  assert.equal(store.getFavorite("artifact", "artifact-1"), undefined);
});

test("refetch reconciles removed entries and avoids duplicate IDs", async () => {
  const store = makeStore();
  favoriteServiceState.getFavorites = async () => [
    favorite({ id: "a", entity_identifier: "entity-a" }),
    favorite({ id: "b", entity_identifier: "entity-b" }),
  ];
  await store.fetchFavorite("one");
  favoriteServiceState.getFavorites = async () => [
    favorite({ id: "b", entity_identifier: "entity-b" }),
    favorite({ id: "c", entity_identifier: "entity-c" }),
  ];

  await store.fetchFavorite("one");

  assert.equal(store.favoriteMap.a, undefined);
  assert.deepEqual(store.favoriteIds.toSorted(), ["b", "c"]);
  assert.equal(store.getFavorite("issue", "entity-a"), undefined);
  assert.equal(store.getFavorite("issue", "entity-c").id, "c");
});

test("an older in-flight fetch cannot restore a favorite deleted while it was loading", async () => {
  const store = makeStore();
  const saved = favorite({ id: "saved", entity_identifier: "issue-1" });
  favoriteServiceState.getFavorites = async () => [saved];
  await store.fetchFavorite("one");

  let finishFetch;
  favoriteServiceState.getFavorites = () =>
    new Promise((resolve) => {
      finishFetch = resolve;
    });
  const staleFetch = store.fetchFavorite("one");
  await store.deleteFavorite("one", saved.id);
  finishFetch([saved]);
  await staleFetch;

  assert.equal(store.favoriteMap[saved.id], undefined);
  assert.equal(store.getFavorite("issue", "issue-1"), undefined);
});
