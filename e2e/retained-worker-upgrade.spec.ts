import { test, expect } from "@playwright/test";
import { createServer, type Server } from "node:http";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generateSW } from "workbox-build";
import ts from "typescript";

let server: Server, directory: string, origin: string;
let upgraded = false;
const scoped = `/_accounts/${"a".repeat(32)}/api/auth/session`;
test.beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), "retained-worker-"));
  const rules = require("../lib/auth/retained-cache-rules.cjs");
  const source = await readFile(join(process.cwd(), "worker/retained-cache-upgrade.ts"), "utf8");
  await writeFile(join(directory, "upgrade.js"), ts.transpileModule(source.replace("export {};", ""), { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.None } }).outputText);
  // Model the installed pre-release NetworkFirst page cache, then generate the
  // replacement using exactly the app's retained rules and activation handler.
  const previous = [{ urlPattern: ({ sameOrigin }: { sameOrigin: boolean }) => sameOrigin, handler: "NetworkFirst" as const, options: { cacheName: "pages" } }];
  for (const [filename, current] of [["old.js", false], ["new.js", true]] as const) {
    await generateSW({ swDest: join(directory, filename), globDirectory: directory, globPatterns: [], mode: "production", skipWaiting: true, clientsClaim: true,
      importScripts: current ? ["/upgrade.js"] : [], runtimeCaching: current ? [...rules, ...previous] : previous });
  }
  server = createServer(async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    const path = new URL(req.url!, "http://localhost").pathname;
    if (path === scoped || path === "/api/auth/session") {
      res.setHeader("Content-Type", "application/json"); res.end(JSON.stringify({ user: { id: "fixture-cleaner" } })); return;
    }
    if (path.endsWith(".js")) {
      try { res.setHeader("Content-Type", "application/javascript"); res.end(await readFile(join(directory, path === "/sw.js" ? upgraded ? "new.js" : "old.js" : path.slice(1)))); }
      catch { res.statusCode = 404; res.end(); }
      return;
    }
    res.setHeader("Content-Type", "text/html"); res.end('<!doctype html><title>Worker fixture</title><textarea id="draft">unfinished photo notes</textarea>');
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  origin = `http://127.0.0.1:${(server.address() as any).port}`;
});
test.afterAll(async () => { await new Promise<void>(resolve => server.close(() => resolve())); await rm(directory, { recursive: true, force: true }); });

test("upgrades an active old worker, removes cached identities, and keeps open drafts", async ({ page, context }) => {
  await page.goto(origin);
  await page.evaluate(async () => {
    await navigator.serviceWorker.register("/sw.js");
    await navigator.serviceWorker.ready;
    if (!navigator.serviceWorker.controller) await new Promise<void>(resolve => navigator.serviceWorker.addEventListener("controllerchange", () => resolve(), { once: true }));
    await (await caches.open("unrelated-drafts")).put("/offline-draft", new Response("keep this evidence"));
  });
  expect(await page.evaluate(async path => (await (await fetch(path)).json()).user.id, scoped)).toBe("fixture-cleaner");
  await expect.poll(() => page.evaluate(async path => !!await caches.match(path), scoped)).toBe(true);
  await context.setOffline(true);
  expect(await page.evaluate(async path => (await (await fetch(path)).json()).user.id, scoped)).toBe("fixture-cleaner");
  await context.setOffline(false);
  upgraded = true;
  await page.evaluate(async () => {
    const changed = new Promise<void>(resolve => navigator.serviceWorker.addEventListener("controllerchange", () => resolve(), { once: true }));
    await (await navigator.serviceWorker.getRegistration())!.update();
    await changed;
  });
  await expect.poll(() => page.evaluate(async path => !!await caches.match(path), scoped)).toBe(false);
  await expect(page.locator("#draft")).toHaveValue("unfinished photo notes");
  expect(await page.evaluate(async () => (await caches.match("/offline-draft"))?.text())).toBe("keep this evidence");
  expect(await page.evaluate(async path => (await (await fetch(path)).json()).user.id, scoped)).toBe("fixture-cleaner");
  await context.setOffline(true);
  expect(await page.evaluate(async path => { try { return !(await fetch(path)).ok; } catch { return true; } }, scoped)).toBe(true);
});
