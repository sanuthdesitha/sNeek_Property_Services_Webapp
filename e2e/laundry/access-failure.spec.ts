import { expect, test } from "../fixtures/local-admin";
test.skip(process.env.SNEEK_E2E_LOCAL_FIXTURES !== "1", "Requires explicitly enabled loopback database fixtures");
test.setTimeout(180_000);
test("access problem requests approval, and uncertain delivery requires refresh", async ({ localAdmin }) => {
  const { page } = localAdmin;
  const day = new Intl.DateTimeFormat("en-CA", { timeZone: "Australia/Sydney", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  const task = { id: "fixture-failure", status: "CONFIRMED", pickupDate: `${day}T00:00:00.000Z`, dropoffDate: `${day}T00:00:00.000Z`, property: { name: "Access test house", address: "1 Test Street" }, confirmations: [] };
  await page.route("**/api/laundry/week?**", route => route.fulfill({ json: [task] }));
  await page.route("**/api/laundry/route", route => route.fulfill({ json: { route: null, tasks: [task], candidates: [] } }));
  await page.route("**/api/laundry/options", route => route.fulfill({ json: { dropoffLocationOptions: [], suppliers: [], portalVisibility: { showPickupPhoto: true } } }));
  const payloads: any[] = []; let uncertain = false;
  await page.route("**/api/laundry/fixture-failure/status", async route => { payloads.push(route.request().postDataJSON()); if (uncertain) await route.abort(); else await route.fulfill({ json: { ...task, status: "FLAGGED" } }); });
  await page.goto("/v2/laundry");
  async function fillReport() {
    await page.getByRole("button", { name: "Report access problem", exact: true }).click();
    await expect(page.getByText("Access-failure photo (optional)")).toBeVisible();
    await page.getByRole("dialog").getByRole("combobox").selectOption("REQUEST_SKIP");
    await page.getByPlaceholder(/No bag outside/).fill("Locked side gate");
    await page.getByRole("dialog").getByRole("checkbox").check();
    await page.getByRole("button", { name: "Confirm", exact: true }).click();
  }
  await fillReport();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(payloads[0]).toMatchObject({ status: "FAILED_PICKUP_REQUEST", requestedAction: "SKIP", failedPickupReason: "Locked side gate" });
  expect(payloads[0].failedPickupPhotoKey).toBeUndefined();
  uncertain = true; await fillReport();
  await expect(page.getByRole("button", { name: "Refresh task", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Confirm", exact: true })).toBeDisabled();
  expect(payloads).toHaveLength(2);
  await page.getByRole("button", { name: "Refresh task", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
});
