import { test, expect } from "@playwright/test";
import { build } from "esbuild";
import path from "node:path";
import { createHash } from "node:crypto";
let bundle: string;
test.beforeAll(async () => {
  bundle = (await build({ entryPoints: [path.resolve("e2e/cleaner/fixtures/online-actions-browser-entry.tsx")], bundle: true, write: false,
    format: "iife", platform: "browser", jsx: "automatic", logLevel: "silent", define: { "process.env.NODE_ENV": '"test"', "process.env": "{}" }, alias: { "@": process.cwd() },
    plugins: [{ name: "synthetic-router", setup(build) {
      build.onResolve({ filter: /^next\/navigation$/ }, () => ({ path: "router", namespace: "fixture" }));
      build.onResolve({ filter: /^next-auth\/react$/ }, () => ({ path: "session", namespace: "fixture" }));
      build.onLoad({ filter: /.*/, namespace: "fixture" }, args => ({ contents: args.path === "session"
        ? 'export const useSession = () => ({status:"authenticated",data:{user:{id:"synthetic-cleaner"}}});'
        : "export const useRouter = () => ({refresh(){}});" }));
    } }],
  })).outputFiles[0].text;
});
test("offers never queue offline and reconcile a lost success across reload without another POST", async ({ page, context }) => {
  let writes = 0; let reads = 0; let recoveries = 0; let requestId = "";
  await context.route("**/__synthetic_online_action", route => route.fulfill({ contentType: "text/html", body: '<!doctype html><html><body><div id="root"></div></body></html>' }));
  await context.route("**/api/cleaner/jobs/synthetic-offer/assignment-response", async route => {
    writes++; requestId = route.request().headers()["x-cleaner-action-id"];
    expect(requestId).toMatch(/^[a-f0-9-]{36}$/);
    await route.abort("failed");
  });
  const draftIdentity = createHash("sha256").update(JSON.stringify(["cleaner-draft-identity-v1", "synthetic-cleaner", "synthetic-cleaner", "synthetic-offer"])).digest("hex");
  await context.route("**/api/cleaner/jobs/synthetic-offer/action-recovery", async route => {
    recoveries++;
    expect(route.request().headers()["x-cleaner-draft-identity"]).toBe(draftIdentity);
    expect(route.request().postDataJSON()).toMatchObject({ requestId, action: "assignment-response", input: { action: "ACCEPT" } });
    await route.fulfill({ json: { ok: true, state: "COMMITTED", result: { status: 200, body: { ok: true, assignmentStatus: "ACCEPTED" } } } });
  });
  await context.route("**/api/jobs/synthetic-offer/form", async route => { reads++; await route.fulfill({ json: { draftIdentity, job: { id: "synthetic-offer" }, assignmentState: { responseStatus: "ACCEPTED" } } }); });
  async function open() { await page.goto("/__synthetic_online_action"); await page.addScriptTag({ content: bundle }); }
  await open();
  await context.setOffline(true);
  await expect(page.getByRole("button", { name: "Accept", exact: true })).toBeDisabled();
  await expect(page.getByRole("status")).toContainText("Reconnect");
  await context.setOffline(false);
  await expect(page.getByRole("button", { name: "Accept", exact: true })).toBeEnabled();
  expect(writes).toBe(0);
  await page.getByRole("button", { name: "Accept", exact: true }).click();
  await expect(page.getByRole("button", { name: "Check assignment status" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Accept", exact: true })).toBeDisabled();
  await open();
  await expect(page.getByRole("button", { name: "Check assignment status" })).toBeVisible();
  await page.getByRole("button", { name: "Check assignment status" }).click();
  await expect(page.getByRole("button", { name: "Check assignment status" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Accept", exact: true })).toBeDisabled();
  expect(writes).toBe(1); expect(reads).toBe(1); expect(recoveries).toBe(1);
});
