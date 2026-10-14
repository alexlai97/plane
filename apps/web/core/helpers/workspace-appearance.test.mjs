import assert from "node:assert/strict";
import test from "node:test";
import { getWorkspaceAppearance } from "./workspace-appearance.ts";

test("workspace appearance keeps supported settings and ignores unknown data", () => {
  assert.deepEqual(getWorkspaceAppearance({ theme: "blue-gray", organization_logo_url: "/org.png", other: true }), {
    theme: "blue-gray",
    organization_logo_url: "/org.png",
  });
});

test("workspace appearance rejects unsafe and malformed logo URLs", () => {
  assert.deepEqual(getWorkspaceAppearance({ organization_logo_url: "javascript:alert(1)" }), {});
  assert.deepEqual(getWorkspaceAppearance({ organization_logo_url: "//evil.test/logo.png" }), {});
  assert.deepEqual(getWorkspaceAppearance({ organization_logo_url: null }), { organization_logo_url: null });
  assert.deepEqual(getWorkspaceAppearance(null), {});
});
