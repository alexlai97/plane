import { test } from "node:test";
import assert from "node:assert/strict";
import {
  cacheWorkspaceAccessPolicy,
  canReadWorkItemDetails,
  clearWorkspaceAccessPolicy,
} from "./workspace-access-policy.ts";

test("work-item detail peek cache fails closed and follows the loaded server policy", () => {
  const workspaceSlug = "policy-cache-test";
  clearWorkspaceAccessPolicy(workspaceSlug);
  assert.equal(canReadWorkItemDetails(workspaceSlug), false);

  cacheWorkspaceAccessPolicy(workspaceSlug, {
    profile: "standard",
    capabilities: ["work_item.detail.read"],
    project_ids: null,
    view_ids: null,
  });
  assert.equal(canReadWorkItemDetails(workspaceSlug), true);

  clearWorkspaceAccessPolicy(workspaceSlug);
  assert.equal(canReadWorkItemDetails(workspaceSlug), false);
});
