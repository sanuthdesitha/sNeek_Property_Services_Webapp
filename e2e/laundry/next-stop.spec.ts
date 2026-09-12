import { expect, test } from "../fixtures/local-admin";

test.skip(process.env.SNEEK_E2E_LOCAL_FIXTURES !== "1", "Requires explicitly enabled loopback database fixtures");
test.setTimeout(180_000);

test("next stop shows access and opens existing pickup checks, then handles refresh failure", async ({ localAdmin }) => {
  const { page } = localAdmin;
  const day = new Intl.DateTimeFormat("en-CA", { timeZone: "Australia/Sydney", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  const task = { id: "fixture-next", status: "CONFIRMED", pickupDate: `${day}T00:00:00.000Z`, dropoffDate: null, property: { name: "Next stop house", address: "1 Test Street", accessGuide: [{ id: "access", kind: "LAUNDRY_PICKUP", label: "Laundry bags", instructions: "Inside side gate", audience: "LAUNDRY", images: [] }] }, confirmations: [] };
  let failed = false;
  await page.route("**/api/laundry/week?**", route => route.fulfill({ json: [task] }));
  await page.route("**/api/laundry/route", route => route.fulfill({ status: failed ? 503 : 200, json: failed ? { error: "offline" } : { route: null, tasks: [task], candidates: [] } }));
  await page.route("**/api/laundry/options", route => route.fulfill({ json: { dropoffLocationOptions: [], suppliers: [], portalVisibility: { showPickupPhoto: true } } }));
  await page.goto("/v2/laundry");
  await expect(page.getByText("Next: Next stop house")).toBeVisible();
  await page.getByText("Laundry access guide", { exact: true }).click();
  await expect(page.getByText("Inside side gate")).toBeVisible();
  await page.getByRole("button", { name: "Confirm pickup", exact: true }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  failed = true;
  await page.getByRole("button", { name: "Refresh", exact: true }).click();
  await expect(page.getByText("Could not load today's route")).toBeVisible();
  await expect(page.getByRole("button", { name: "Confirm pickup", exact: true })).toHaveCount(0);
});
