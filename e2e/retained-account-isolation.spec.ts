import { captureOperationsLayout } from "./operations-layout";
import { test, expect } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { randomUUID } from "node:crypto";
import bcrypt from "bcryptjs";

const origin = process.env.SNEEK_TEST_SERVER_ORIGIN;
const database = process.env.SNEEK_TEST_DATABASE_URL;
test.skip(!origin || !database, "Requires the isolated account fixture server and disposable database");
let db: PrismaClient;
let owner: string, cleaner: string;
let beforeKeys: Set<string>;
const password = "Local-fixture-password-27!";
test.beforeAll(async () => {
  if (origin !== "http://localhost:3002" || new URL(database!).hostname !== "127.0.0.1" || new URL(database!).port !== "55439") throw Error("Isolated loopback fixtures required");
  db = new PrismaClient({ datasources: { db: { url: database } } });
  owner = `qa-browser-owner-${randomUUID()}`; cleaner = `qa-browser-cleaner-${randomUUID()}`;
  beforeKeys = new Set((await db.appSetting.findMany({ where: { key: { startsWith: "retained_account_" } }, select: { key: true } })).map(row => row.key));
  const passwordHash = await bcrypt.hash(password, 4);
  await db.user.createMany({ data: [{ id: owner, name: "Fixture Admin", email: `${owner}@example.invalid`, role: "ADMIN", passwordHash }, { id: cleaner, name: "Fixture Cleaner", email: `${cleaner}@example.invalid`, role: "CLEANER", passwordHash }] });
});
test.afterAll(async () => {
  if (!db) return;
  const created = (await db.appSetting.findMany({ where: { key: { startsWith: "retained_account_" } }, select: { key: true } })).map(row => row.key).filter(key => !beforeKeys.has(key));
  await db.appSetting.deleteMany({ where: { key: { in: created } } });
  await db.auditLog.deleteMany({ where: { userId: { in: [owner, cleaner] } } });
  await db.user.deleteMany({ where: { id: { in: [owner, cleaner] } } });
  await db.$disconnect();
});
test("retains Admin and Cleaner tabs, isolates real session/role requests, and revokes without fallback", async ({ browser }) => {
  const context = await browser.newContext();
  await context.route("**/*", route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
  const csrf = await (await context.request.get(`${origin}/api/auth/csrf`)).json();
  const signed = await context.request.post(`${origin}/api/auth/callback/credentials`, { form: { email: `${owner}@example.invalid`, password, csrfToken: csrf.csrfToken, json: "true", callbackUrl: `${origin}/accounts` } });
  expect((await signed.json()).url).not.toContain("error");
  const manager = await context.newPage();
  await manager.goto(`${origin}/accounts`);
  await expect(manager.getByLabel("Email", { exact: true })).toHaveValue(`${owner}@example.invalid`);
  await captureOperationsLayout(manager,"account-enrollment");
  await manager.getByLabel("Password", { exact: true }).fill(password);
  await manager.getByRole("button", { name: "Verify account", exact: true }).click();
  await expect(manager.getByText("Verify your other account")).toBeVisible();
  await manager.getByLabel("Email", { exact: true }).fill(`${cleaner}@example.invalid`);
  await manager.getByLabel("Password", { exact: true }).fill(password);
  await manager.getByRole("button", { name: "Verify account", exact: true }).click();
  await manager.getByRole("checkbox").check();
  await manager.getByRole("button", { name: "Link my accounts" }).click();
  const adminLink = manager.getByRole("link", { name: "Open Admin", exact: true });
  const cleanerLink = manager.getByRole("link", { name: "Open Cleaner", exact: true });
  await expect(adminLink).toBeVisible(); await expect(cleanerLink).toBeVisible();
  const adminPath = (await adminLink.getAttribute("href"))!, cleanerPath = (await cleanerLink.getAttribute("href"))!;
  await captureOperationsLayout(manager,"account-linked");
  await manager.screenshot({ path: "/tmp/sneek-retained-account-manager.png", fullPage: true });
  const adminTab = await context.newPage(), cleanerTab = await context.newPage();
  const direct = await context.request.get(`${origin}/api/auth/retained/validate?context=${cleanerPath.split("/")[2]}`);
  expect(direct.status()).toBe(200);
  expect((await direct.json()).id).toBe(cleaner);
  const scopedSession = await context.request.get(`${origin}/_accounts/${cleanerPath.split("/")[2]}/api/auth/session`);
  const scopedBody = await scopedSession.json();
  expect(scopedBody.user?.id).toBe(cleaner);
  expect(scopedSession.headersArray().filter(header => header.name.toLowerCase() === "set-cookie").some(header => /^(?:__Secure-)?next-auth\.session-token[.=]/.test(header.value))).toBe(false);
  await Promise.all([adminTab.goto(`${origin}${adminPath}`), cleanerTab.goto(`${origin}${cleanerPath}`)]);
  await expect(adminTab).toHaveURL(`${origin}${adminPath}`);
  await expect(cleanerTab).toHaveURL(`${origin}${cleanerPath}`);
  const identity = (page: typeof adminTab) => page.evaluate(async () => (await (await fetch("/api/auth/session")).json()).user?.id);
  await expect.poll(() => identity(adminTab)).toBe(owner);
  await expect.poll(() => identity(cleanerTab)).toBe(cleaner);
  expect(await adminTab.evaluate(async () => (await fetch("/api/admin/users")).status)).toBe(200);
  expect(await cleanerTab.evaluate(async () => (await fetch("/api/admin/users")).status)).toBe(403);
  // An API call missing its tab context cannot fall back to the root Admin cookie.
  expect((await context.request.post(`${origin}/api/admin/users`, { headers: { referer: `${origin}${cleanerPath}` }, data: {} })).status()).toBe(409);
  expect((await (await context.request.get(`${origin}/api/auth/session`)).json()).user.id).toBe(owner);
  // Exercise the generated production service worker outside Providers' local
  // development cleanup. Offline responses must not replay a retained identity.
  const cacheContext = await browser.newContext();
  await cacheContext.addCookies(await context.cookies());
  await cacheContext.route("**/*", route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
  await cacheContext.route(`${origin}/account-cache-fixture`, route => route.fulfill({ contentType: "text/html", body: "<!doctype html><title>Local account cache fixture</title>" }));
  const cacheTab = await cacheContext.newPage();
  await cacheTab.goto(`${origin}/account-cache-fixture`);
  await cacheTab.evaluate(async () => {
    const registration = await navigator.serviceWorker.register("/sw.js");
    await Promise.race([navigator.serviceWorker.ready, new Promise((_, reject) => setTimeout(() => reject(new Error(`Worker activation timed out: installing=${registration.installing?.state}, waiting=${registration.waiting?.state}, active=${registration.active?.state}`)), 15000))]);
    if (!navigator.serviceWorker.controller) await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("Worker did not take control")), 15000);
      navigator.serviceWorker.addEventListener("controllerchange", () => { clearTimeout(timeout); resolve(); }, { once: true });
    });
  });
  const selectedSessionPath = `/_accounts/${cleanerPath.split("/")[2]}/api/auth/session`;
  expect(await cacheTab.evaluate(async path => (await (await fetch(path)).json()).user?.id, selectedSessionPath)).toBe(cleaner);
  await cacheContext.setOffline(true);
  try {
    expect(await cacheTab.evaluate(async path => { try { return !(await fetch(path)).ok; } catch { return true; } }, selectedSessionPath)).toBe(true);
  } finally { await cacheContext.setOffline(false); }
  await cacheContext.close();
  const adminId = adminPath.split("/")[2];
  const revoked = await manager.evaluate(async id => (await fetch("/api/auth/retained", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "revoke", contextId: id }) })).status, adminId);
  expect(revoked).toBe(200);
  expect(await adminTab.evaluate(async () => (await fetch("/api/auth/session")).status)).toBe(401);
  expect(await identity(cleanerTab)).toBe(cleaner);
  // Fixed expiry applies on the very next request, independent of the still-valid root cookie.
  const links = await db.appSetting.findMany({ where: { key: { startsWith: "retained_account_link_v1:" } } });
  const link = links.find(row => (row.value as any)?.ownerId === owner)!;
  await db.appSetting.update({ where: { key: link.key }, data: { value: { ...(link.value as any), expiresAt: "2000-01-01T00:00:00Z" } } });
  expect(await cleanerTab.evaluate(async () => (await fetch("/api/auth/session")).status)).toBe(401);
  await context.close();
});
