import { test, expect, type Page } from "@playwright/test";
import { build } from "esbuild";
import path from "node:path";
let bundle: string;
const context = "a".repeat(64);
test.beforeAll(async () => {
  bundle = (await build({ entryPoints: [path.resolve("e2e/client/fixtures/job-chat-browser-entry.tsx")], bundle: true, write: false, format: "iife", platform: "browser", logLevel: "silent", jsx: "automatic", define: { "process.env.NODE_ENV": '"test"' }, alias: { "@": process.cwd(), "next-auth/react": path.resolve("e2e/client/fixtures/job-chat-session.ts") } })).outputFiles[0].text;
});
async function mount(page: Page) {
  await page.route("**/__synthetic_job_chat", route => route.fulfill({ contentType: "text/html", body: '<!doctype html><html><head><style>[role=dialog]{position:fixed;inset:5%;background:white;border:1px solid;padding:12px;overflow:auto}button,textarea{min-height:44px}textarea{display:block;width:75%}</style></head><body><div id="root"></div></body></html>' }));
  await page.goto("/__synthetic_job_chat"); await page.addScriptTag({ content: bundle });
}
const headers = { "X-Client-Message-Context": context, "X-Client-Message-History-Limited": "false" };
test("real dialog traps focus, Escape restores opener, and a draft survives reload", async ({ page }) => {
  await page.route("**/api/client/messages**", route => route.fulfill({ json: [], headers })); await mount(page);
  const opener = page.getByRole("button", { name: "Open clean conversation" }); await opener.click();
  const dialog = page.getByRole("dialog", { name: "Message us about this clean" }); await expect(dialog).toBeVisible();
  await expect(dialog.getByText("Client correspondence with the office")).toBeVisible();
  const input = dialog.getByRole("textbox"); await expect(input).toBeEnabled(); await input.fill("Retained unsent draft");
  for (let index = 0; index < 8; index++) { await page.keyboard.press("Tab"); expect(await page.evaluate(() => !!document.activeElement?.closest('[role="dialog"]'))).toBe(true); }
  await page.keyboard.press("Escape"); await expect(dialog).toHaveCount(0); await expect(opener).toBeFocused();
  await page.reload(); await page.addScriptTag({ content: bundle }); await page.getByRole("button", { name: "Open clean conversation" }).click(); await expect(page.getByRole("dialog").getByRole("textbox")).toHaveValue("Retained unsent draft");
});
test("lost acknowledgement survives reload and retries the identical receipt only on request", async ({ page }) => {
  const posts: any[] = [];
  await page.route("**/api/client/messages**", async route => {
    if (route.request().method() !== "POST") return route.fulfill({ json: [], headers });
    const body = route.request().postDataJSON(); posts.push(body);
    if (posts.length === 1) return route.abort();
    return route.fulfill({ headers, json: { id: "saved-message", jobId: "chat-job", body: body.body, requestId: body.requestId, duplicated: true, isFromAdmin: false, createdAt: "2026-09-13T00:00:00Z", sentBy: { id: "chat-client", name: "Client", role: "CLIENT" } } });
  });
  await mount(page); await page.getByRole("button", { name: "Open clean conversation" }).click(); await page.getByRole("dialog").getByRole("textbox").fill("Message with uncertain outcome"); await page.getByRole("button", { name: "Send message", exact: true }).click();
  await expect(page.getByRole("button", { name: "Retry same message", exact: true })).toBeEnabled(); expect(posts).toHaveLength(1);
  await page.reload(); await page.addScriptTag({ content: bundle }); await page.getByRole("button", { name: "Open clean conversation" }).click();
  await expect(page.getByRole("dialog").getByRole("textbox")).toHaveValue("Message with uncertain outcome"); await expect(page.getByRole("dialog").getByRole("textbox")).toBeDisabled(); expect(posts).toHaveLength(1);
  await page.getByRole("button", { name: "Retry same message", exact: true }).click(); await expect(page.getByRole("status")).toHaveText("Message saved."); expect(posts).toHaveLength(2); expect(posts[1]).toEqual(posts[0]);
  await expect(page.getByRole("dialog").getByRole("textbox")).toHaveValue(""); await expect(page.getByRole("article")).toHaveCount(1);
});
