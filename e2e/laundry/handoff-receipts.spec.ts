import { expect, test } from "../fixtures/local-admin";

test.skip(process.env.SNEEK_E2E_LOCAL_FIXTURES !== "1", "Requires explicitly enabled loopback database fixtures");
test.setTimeout(180_000);

test("tracking shows recorded handoff actors and corrections without changing the task", async ({ localAdmin }) => {
  const { page } = localAdmin;
  const day = new Intl.DateTimeFormat("en-CA", { timeZone: "Australia/Sydney", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  let mutations = 0;
  await page.route("**/api/laundry/**", async route => {
    if (route.request().method() !== "GET") { mutations++; await route.fulfill({ status: 500, json: { error: "No mutations in receipt test" } }); return; }
    if (route.request().url().includes("/week?")) {
      await route.fulfill({ json: [{ id: "receipt-task", status: "DROPPED", pickupDate: `${day}T00:00:00Z`, dropoffDate: `${day}T00:00:00Z`, property: { id: "receipt-property", name: "Receipt house", suburb: "Sydney", laundryEnabled: true }, confirmations: [
        { id: "ready", confirmedByName: "Cleaner Alex", laundryReady: true, createdAt: `${day}T00:00:00Z`, bagLocation: "Side gate", notes: null },
        { id: "pickup", confirmedByName: "Driver Sam", createdAt: `${day}T01:00:00Z`, notes: '{"event":"PICKED_UP","bagCount":3}' },
        { id: "return", confirmedByName: "Driver Sam", createdAt: `${day}T02:00:00Z`, notes: '{"event":"DROPPED","dropoffLocation":"Cupboard"}', photoUrl: "https://example.invalid/receipt.jpg" },
        { id: "correction", confirmedByName: null, createdAt: `${day}T03:00:00Z`, notes: '{"event":"EDIT_COMPLETED","reason":"One bag missed","changedFields":["bagCount"],"before":{"bagCount":2},"after":{"bagCount":3}}' },
      ] }] });
    } else await route.fulfill({ json: {} });
  });
  await page.goto("/v2/laundry/tracking");
  await page.getByText("Recorded handoffs (4)", { exact: true }).click();
  await expect(page.getByText(/Recorded by Cleaner Alex/)).toBeVisible();
  await expect(page.getByText("Pickup recorded", { exact: true })).toBeVisible();
  await expect(page.getByText("Return recorded", { exact: true })).toBeVisible();
  await expect(page.getByText("Bags: 2 → 3", { exact: true })).toBeVisible();
  await expect(page.getByText(/Recorded by Name unavailable/)).toBeVisible();
  await expect(page.getByText(/not acceptance by a recipient/)).toBeVisible();
  await expect(page.getByRole("link", { name: "View recorded photo", exact: true })).toHaveAttribute("href", "https://example.invalid/receipt.jpg");
  expect(mutations).toBe(0);
});
