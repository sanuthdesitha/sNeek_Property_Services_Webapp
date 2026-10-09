import { test, expect } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { randomUUID } from "node:crypto";
import bcrypt from "bcryptjs";
const db = new PrismaClient({
  datasources: {
    db: { url: "postgresql://sneek@127.0.0.1:55439/sneek_review_test" },
  },
});
const owner = randomUUID(),
  client = randomUUID(),
  property = randomUUID(),
  job = randomUUID();
const password = "Jobs-loading-fixture-27!";
test.beforeAll(async () => {
  await db.user.create({
    data: {
      id: owner,
      name: "Jobs owner fixture",
      email: `${owner}@example.invalid`,
      role: "ADMIN",
      passwordHash: await bcrypt.hash(password, 4),
    },
  });
  await db.client.create({ data: { id: client, name: "Jobs loading client" } });
  await db.property.create({
    data: {
      id: property,
      clientId: client,
      name: "Jobs loading property",
      address: "Fixture",
      suburb: "Sydney",
    },
  });
  await db.job.create({
    data: {
      id: job,
      jobNumber: job,
      propertyId: property,
      status: "UNASSIGNED",
      jobType: "AIRBNB_TURNOVER",
      scheduledDate: new Date("2026-10-09"),
    },
  });
});
test.afterAll(async () => {
  await db.notification.deleteMany({ where: { userId: owner } });
  await db.auditLog.deleteMany({ where: { userId: owner } });
  await db.job.deleteMany({ where: { id: job } });
  await db.property.deleteMany({ where: { id: property } });
  await db.client.deleteMany({ where: { id: client } });
  await db.user.deleteMany({ where: { id: owner } });
  await db.$disconnect();
});
test("owner Jobs loads real records and retries a temporary error without losing filters", async ({
  page,
  context,
}, info) => {
  const csrf = await (await context.request.get("/api/auth/csrf")).json();
  await context.request.post("/api/auth/callback/credentials", {
    form: {
      email: `${owner}@example.invalid`,
      password,
      csrfToken: csrf.csrfToken,
      json: "true",
    },
  });
  const api = await context.request.get(
    `/api/jobs?paginated=1&limit=50&search=${job}`,
  );
  expect(api.status()).toBe(200);
  expect(
    (await api.json()).jobs.some((row: { id: string }) => row.id === job),
  ).toBe(true);
  // Exercise the other two reported failures against real owner authorization.
  expect(
    (
      await context.request.get("/api/admin/integrations/ical-sync-runs")
    ).status(),
  ).toBe(200);
  const unlock = await context.request.post("/api/admin/test-as/unlock", {
    data: { password },
  });
  expect(unlock.status()).toBe(200);
  // Production correctly sets a Secure proof cookie. This fixture uses HTTP
  // loopback, so explicitly round-trip that proof for the API assertion.
  expect(unlock.headers()["set-cookie"]).toContain("Secure");
  const proof = unlock
    .headers()
    ["set-cookie"].match(/sneek\.test-as-unlock=([^;]+)/)?.[1];
  expect(proof).toBeTruthy();
  const sessionCookies = (await context.cookies())
    .filter((cookie) => cookie.name !== "sneek.test-as-unlock")
    .map((cookie) => `${cookie.name}=${cookie.value}`)
    .join("; ");
  const unlocked = await context.request.get("/api/admin/test-as/unlock", {
    headers: { cookie: `${sessionCookies}; sneek.test-as-unlock=${proof}` },
  });
  expect((await unlocked.json()).unlocked).toBe(true);
  // The fixture intentionally points middleware's HTTP validation callback at
  // a closed port. Owner access must still use live, in-process authorization.
  for (const href of [
    "/v2/admin/properties",
    "/v2/admin/laundry",
    "/v2/admin/finance",
    "/v2/admin/settings?tab=ical-sync",
  ]) {
    const response = await page.goto(href);
    expect(response?.status()).toBe(200);
    await expect(
      page.getByText("Permissions are temporarily unavailable.", {
        exact: true,
      }),
    ).toHaveCount(0);
  }
  let fail = true;
  await page.route("**/api/jobs?*", (route) =>
    fail
      ? route.fulfill({ status: 503, json: { error: "synthetic outage" } })
      : route.continue(),
  );
  await page.goto(`/v2/admin/jobs?search=${job}`);
  await expect(
    page
      .getByRole("alert")
      .filter({ hasText: "Jobs are temporarily unavailable" }),
  ).toBeVisible();
  fail = false;
  await page.getByRole("button", { name: "Retry", exact: true }).click();
  await expect(
    page.getByText("Jobs loading property", { exact: true }).first(),
  ).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Search jobs" })).toHaveValue(
    job,
  );
  const filters = page.locator("details").first();
  const summary = filters.locator("summary");
  await summary.focus();
  await summary.press("Enter");
  await expect(filters).not.toHaveAttribute("open", "");
  await page.goto(`/v2/admin/jobs?search=${job}`);
  await expect(filters).not.toHaveAttribute("open", "");
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Jobs", exact: true }),
  ).toBeVisible();
  await expect(filters).not.toHaveAttribute("open", "");
  await summary.click();
  await expect(filters).toHaveAttribute("open", "");
  await page.goto(`/v2/admin/jobs?search=${job}`);
  await expect(filters).toHaveAttribute("open", "");
  await summary.click();
  await expect(filters).not.toHaveAttribute("open", "");
  for (const width of [390, 1280])
    for (const dark of [false, true]) {
      await page.setViewportSize({ width, height: 900 });
      await page.evaluate((value) => {
        document
          .querySelectorAll(".dark")
          .forEach((node) => node.classList.remove("dark"));
        document.documentElement.classList.toggle("dark", value);
        document.documentElement.classList.toggle("light", !value);
      }, dark);
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth + 1,
        ),
      ).toBe(true);
      await page.screenshot({
        path: info.outputPath(`jobs-${width}-${dark}.png`),
        fullPage: true,
      });
    }
});
