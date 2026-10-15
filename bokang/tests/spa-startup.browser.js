// Run against an authenticated gallery already open in playwright-cli:
// playwright-cli -s=startup run-code "$(cat bokang/tests/spa-startup.browser.js)"
async function checkSpaStartup(page) {
  if (!page.url().split("?")[0].endsWith("/gallery/"))
    throw new Error("Open the authenticated gallery before running this check");
  const target = await page.evaluate(() => {
    const url = new URL(window.location.href);
    url.search = "layout=tree";
    return url.href;
  });
  const errors = [];
  const onError = (error) => errors.push(String(error));
  page.on("pageerror", onError);
  const cdp = await page.context().newCDPSession(page);
  try {
    await page.addInitScript(() => performance.setResourceTimingBufferSize(3000));
    await cdp.send("Network.enable");
    await cdp.send("Network.clearBrowserCache");
    const responsePromise = page.waitForResponse(
      (response) =>
        response.url().includes("/api/workspaces/") &&
        response.url().split("?")[0].endsWith("/gallery/") &&
        ["xhr", "fetch"].includes(response.request().resourceType())
    );
    await page.goto(target);
    const response = await responsePromise;
    if (response.status() !== 200) throw new Error(`Gallery returned ${response.status()}`);
    const data = await response.json();
    await page.getByRole("heading", { name: "成果总览", exact: true }).waitFor();
    if (data.cards.length) await page.locator("[data-artifact-assignees]").first().waitFor();
    await page.waitForLoadState("networkidle");
    const visibleResults = await page.locator("[data-artifact-assignees]").count();
    if (visibleResults !== data.cards.length)
      throw new Error(`Expected ${data.cards.length} results, saw ${visibleResults}`);
    if (errors.length) throw new Error(`Startup page errors: ${errors.join("\n")}`);
    const resources = await page.evaluate(() =>
      performance.getEntriesByType("resource").map((entry) => ({
        path: new URL(entry.name).pathname,
        transfer: entry.transferSize,
        decoded: entry.decodedBodySize,
      }))
    );
    const eagerFeatureChunks = resources.filter((entry) =>
      /document-collaborative-events|use-parse-editor-content|generateCategoricalChart/.test(entry.path)
    );
    if (eagerFeatureChunks.length)
      throw new Error(`Closed features loaded on startup: ${eagerFeatureChunks.map((entry) => entry.path).join(", ")}`);
    return { pageErrors: errors.length, visibleResults, resources };
  } finally {
    await cdp.detach();
    page.off("pageerror", onError);
  }
}
