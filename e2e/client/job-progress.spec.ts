import { test, expect } from "../fixtures/local-client";

test.skip(process.env.SNEEK_E2E_LOCAL_FIXTURES !== "1", "Requires isolated local fixtures");
test.setTimeout(180000);

test("job privacy and progress failure recover without losing the last estimate", async ({ localClient }) => {
  const { db, page, clientId, id } = localClient;
  const propertyId = `${id}-property`;
  const jobId = `${id}-progress`;
  try {
    await db.client.update({ where: { id: clientId }, data: { portalVisibilityOverrides: { showJobs: true, showLiveProgress: true, showCleanerNames: false, showReports: false, showFinanceDetails: false, showLaundryUpdates: false } } });
    await db.property.create({ data: { id: propertyId, clientId, name: "Progress fixture", address: "1 Fixture Street", suburb: "Sydney" } });
    await db.job.create({ data: { id: jobId, jobNumber: jobId, propertyId, jobType: "GENERAL_CLEAN", status: "IN_PROGRESS", scheduledDate: new Date(), arrivedAt: new Date(), estimatedHours: 2 } });
    const api = await page.request.get(`/api/client/jobs/${jobId}`);
    expect(api.ok()).toBe(true);
    const body = await api.json();
    expect(body).not.toHaveProperty("cleanerLocationPings"); expect(body.liveTrip).toBeNull(); expect(body.assignments).toEqual([]); expect(body.report).toBeNull(); expect(body.invoiceLines).toEqual([]); expect(body.laundryTask).toBeNull();
    let fail = true;
    await page.route(`**/api/client/jobs/${jobId}`, (route) => route.fulfill(fail ? { status: 503, json: { error: "Unavailable" } } : { json: { id: jobId, status: "IN_PROGRESS", progressPercent: 42 } }));
    await page.goto(`/v2/client/jobs/${jobId}`);
    await expect(page.getByText(/Could not refresh progress/)).toBeVisible();
    await expect(page.getByText(/elapsed time/)).toBeVisible();
    fail = false;
    await page.getByRole("button", { name: "Retry progress" }).click();
    await expect(page.getByRole("progressbar", { name: "Checklist progress" })).toHaveAttribute("aria-valuenow", "42");
    await expect(page.getByText(/Last checked/)).toBeVisible();
    await expect(page.getByText(/Could not refresh progress/)).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
  } finally {
    await db.job.deleteMany({ where: { id: jobId, propertyId } });
    await db.property.deleteMany({ where: { id: propertyId, clientId } });
  }
});
