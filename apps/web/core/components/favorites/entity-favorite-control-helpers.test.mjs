import assert from "node:assert/strict";
import test from "node:test";
import { createFavoritePayload, getFavoriteLabel, toggleEntityFavorite } from "./entity-favorite-control-helpers.ts";

test("favorite labels reflect the current state", () => {
  assert.equal(getFavoriteLabel(false), "收藏");
  assert.equal(getFavoriteLabel(true), "已收藏");
});

test("adding a favorite sends its type, identifier, display name, and project", async () => {
  let payload;
  const result = await toggleEntityFavorite({
    isFavorite: false,
    favoritePayload: createFavoritePayload({
      entityType: "issue",
      entityId: "issue-1",
      projectId: "project-1",
      workspaceId: "workspace-1",
      name: "Fix login",
    }),
    addFavorite: async (value) => {
      payload = value;
    },
    removeFavorite: async () => assert.fail("remove should not be called"),
  });

  assert.equal(result, "added");
  assert.deepEqual(payload, {
    entity_type: "issue",
    entity_identifier: "issue-1",
    name: "Fix login",
    entity_data: { name: "Fix login" },
    project_id: "project-1",
    workspace_id: "workspace-1",
  });
});

test("removing a favorite delegates to the entity removal action", async () => {
  let removed = false;
  const result = await toggleEntityFavorite({
    isFavorite: true,
    favoritePayload: createFavoritePayload({ entityType: "issue", entityId: "issue-1" }),
    addFavorite: async () => assert.fail("add should not be called"),
    removeFavorite: async () => {
      removed = true;
    },
  });

  assert.equal(result, "removed");
  assert.equal(removed, true);
});

test("the favorites menu opens only after the add succeeds", async () => {
  const events = [];
  await toggleEntityFavorite({
    isFavorite: false,
    favoritePayload: createFavoritePayload({ entityType: "issue", entityId: "issue-1" }),
    addFavorite: async () => events.push("add"),
    removeFavorite: async () => assert.fail("remove should not be called"),
    onAdded: () => events.push("open"),
  });

  assert.deepEqual(events, ["add", "open"]);
});

test("a storage failure while opening favorites does not fail the add", async () => {
  let added = false;
  const result = await toggleEntityFavorite({
    isFavorite: false,
    favoritePayload: createFavoritePayload({ entityType: "issue", entityId: "issue-1" }),
    addFavorite: async () => {
      added = true;
    },
    removeFavorite: async () => assert.fail("remove should not be called"),
    onAdded: () => {
      throw new Error("local storage blocked");
    },
  });

  assert.equal(added, true);
  assert.equal(result, "added");
});

test("a failed add does not open the favorites menu", async () => {
  let opened = false;
  await assert.rejects(
    toggleEntityFavorite({
      isFavorite: false,
      favoritePayload: createFavoritePayload({ entityType: "issue", entityId: "issue-1" }),
      addFavorite: async () => {
        throw new Error("offline");
      },
      removeFavorite: async () => {},
      onAdded: () => {
        opened = true;
      },
    }),
    /offline/
  );

  assert.equal(opened, false);
});

test("mutation errors propagate so the control can show an error toast", async () => {
  const expected = new Error("offline");
  await assert.rejects(
    toggleEntityFavorite({
      isFavorite: false,
      favoritePayload: createFavoritePayload({ entityType: "issue", entityId: "issue-1" }),
      addFavorite: async () => {
        throw expected;
      },
      removeFavorite: async () => {},
    }),
    expected
  );
});
