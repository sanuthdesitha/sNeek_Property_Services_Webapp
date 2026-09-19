import { expect, test } from "../fixtures/local-admin";
test.skip(process.env.SNEEK_E2E_LOCAL_FIXTURES !== "1", "Requires explicit loopback fixtures");
test.setTimeout(180_000);
test("pickup explains discrepancy and office can review immutable expected and actual bags", async ({ localAdmin }) => {
  const { page } = localAdmin; const day = new Intl.DateTimeFormat("en-CA", { timeZone: "Australia/Sydney", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  const task = { id: "quantity-task", status: "CONFIRMED", pickupDate: `${day}T00:00:00Z`, dropoffDate: `${day}T00:00:00Z`, property: { name: "Quantity house", address: "1 Test Street" }, confirmations: [{ id: "baseline", notes: '{"source":"EARLY_UPDATE","laundryOutcome":"READY_FOR_PICKUP","bagCount":3,"unit":"bags"}' }] };
  await page.route("**/api/laundry/week?**", route => route.fulfill({ json: [task] })); await page.route("**/api/laundry/route", route => route.fulfill({ json: { route: null, tasks: [task], candidates: [] } }));
  await page.route("**/api/laundry/options", route => route.fulfill({ json: { dropoffLocationOptions: [], suppliers: [], portalVisibility: { showPickupPhoto: false } } }));
  await page.goto("/v2/laundry"); await page.getByRole("button", { name: "Confirm pickup", exact: true }).click();
  await expect(page.getByText(/Cleaner reported 3 bags ready/)).toBeVisible();
  await expect(page.getByText("Pickup photo (required for quantity difference)")).toBeVisible();
  await page.getByPlaceholder(/Explain the expected/).fill("Two bags were missing");
  await page.getByRole("dialog").getByRole("checkbox").check(); await page.getByRole("button", { name: "Confirm", exact: true }).click();
  await expect(page.getByRole("dialog")).toBeVisible(); await page.getByRole("button", { name: "Cancel", exact: true }).click();
  let resolved = false; let resolution: any;
  await page.route("**/api/laundry/quantity-exceptions**", async route => {
    const row = { id: "exception", laundryTaskId: null, propertyName: "Quantity house", expectedCount: 3, actualCount: 1, reason: "Two bags were missing", photoUrl: "https://example.invalid/proof.jpg", createdAt: `${day}T00:00:00Z`, resolvedAt: resolved ? `${day}T01:00:00Z` : null, resolutionNote: resolved ? "Reviewed with cleaner" : null, version: resolved ? 1 : 0 };
    if (route.request().method() === "PATCH") { resolution = route.request().postDataJSON(); resolved = true; await route.fulfill({ json: { ...row, resolvedAt: `${day}T01:00:00Z` } }); }
    else { const showResolved = new URL(route.request().url()).searchParams.get("resolved") === "true"; await route.fulfill({ json: { rows: resolved === showResolved ? [row] : [], total: resolved === showResolved ? 1 : 0, nextCursor: null, canResolve: true } }); }
  });
  await page.goto("/v2/laundry/tracking"); const queue = page.getByRole("region", { name: "Bag quantity exceptions" });
  await expect(queue.getByText("Expected 3 bags · Collected 1 bags")).toBeVisible();
  await expect(queue.getByText(/Original task has been removed/)).toBeVisible();
  await queue.getByRole("textbox", { name: "Resolution note" }).fill("Reviewed with cleaner"); await queue.getByRole("button", { name: "Resolve exception" }).click();
  await expect(queue.getByText("0 open exceptions · 0 shown")).toBeVisible(); expect(resolution).toMatchObject({ id: "exception", version: 0, note: "Reviewed with cleaner" });
  await queue.getByRole("checkbox", { name: "Show resolved" }).check(); await expect(queue.getByText("Resolved: Reviewed with cleaner")).toBeVisible(); await expect(queue.getByText("Expected 3 bags · Collected 1 bags")).toBeVisible();
});
