import { test, expect } from "../fixtures/local-client";
test.skip(process.env.SNEEK_E2E_LOCAL_FIXTURES !== "1", "Requires explicitly enabled loopback database fixtures");
test.setTimeout(180_000);
test("personal pins and compact portfolio survive reload with scoped service summaries", async ({ localClient }) => {
  const { page, db, id, clientId } = localClient;
  const first = `${id}-alpha`; const second = `${id}-beta`;
  const preferenceKey = `client_property_favorites_v1:${encodeURIComponent(id)}:${encodeURIComponent(clientId)}:client`;
  try {
    await db.property.createMany({ data: [
      { id: first, clientId, name: "Alpha fixture property", address: "1 Fixture Street", suburb: "Sydney" },
      { id: second, clientId, name: "Beta fixture property", address: "2 Fixture Street", suburb: "Sydney" },
    ] });
    await db.job.create({ data: { id: `${id}-job`, jobNumber: `${id}-job`, propertyId: second, jobType: "DEEP_CLEAN", status: "ASSIGNED", scheduledDate: new Date("2099-10-04T00:00:00Z"), startTime: "09:00" } });
    await page.goto("/v2/client");
    const portfolio = page.getByRole("region", { name: "Property portfolio" });
    await expect(portfolio.getByRole("button", { name: "Pin Beta fixture property" })).toBeEnabled({ timeout: 30_000 });
    await expect(portfolio.getByRole("article").first()).toContainText("Alpha fixture property");
    await portfolio.getByRole("button", { name: "Pin Beta fixture property" }).click();
    await expect(portfolio.getByRole("article").first()).toContainText("Beta fixture property");
    await expect(portfolio.getByRole("article").first()).toContainText("planned 09:00");
    await portfolio.getByRole("button", { name: "Compact", exact: true }).click();
    await expect(portfolio.getByRole("button", { name: "Compact", exact: true })).toHaveAttribute("aria-pressed", "true");
    await page.reload();
    await expect(portfolio.getByRole("button", { name: "Unpin Beta fixture property" })).toBeEnabled({ timeout: 30_000 });
    await expect(portfolio.getByRole("button", { name: "Compact", exact: true })).toHaveAttribute("aria-pressed", "true");
    const stored = await db.appSetting.findUnique({ where: { key: preferenceKey } });
    expect(stored?.value).toMatchObject({ ids: [second], view: "compact", revision: 2 });
    // Two reviews of the same version: the first wins; the stale writer cannot overwrite it.
    const envelope = await (await page.request.get("/api/client/property-favorites")).json();
    const results = await Promise.all(["cards", "compact"].map(view => page.request.patch("/api/client/property-favorites", { headers: { "X-Property-Preferences-Context": envelope.context }, data: { action: "view", view, revision: envelope.state.revision } })));
    expect(results.map(result => result.status()).sort()).toEqual([200, 409]);
  } finally {
    await db.appSetting.deleteMany({ where: { key: preferenceKey } });
    await db.job.deleteMany({ where: { id: `${id}-job`, propertyId: second } });
    await db.property.deleteMany({ where: { id: { in: [first, second] }, clientId } });
  }
});
