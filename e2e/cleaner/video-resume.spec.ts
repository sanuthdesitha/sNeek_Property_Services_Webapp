import { test, expect } from "@playwright/test";
import { build } from "esbuild";
import fs from "node:fs/promises";
import path from "node:path";
import postcss from "postcss";
import tailwind from "tailwindcss";
let bundle: string, css: string;
test.beforeAll(async () => {
 bundle = (await build({ entryPoints: [path.resolve("e2e/cleaner/fixtures/video-resume-entry.tsx")], bundle: true, write: false, format: "iife", platform: "browser", jsx: "automatic", define: { "process.env.NODE_ENV": '"test"' }, alias: { "@": process.cwd() } })).outputFiles[0].text;
 css = (await postcss([tailwind({ config: path.resolve("tailwind.config.ts") })]).process(await fs.readFile("app/globals.css", "utf8"), { from: "app/globals.css" })).css + await fs.readFile("app/v2/estate.css", "utf8");
});
for (const kind of ["video", "photo"]) for (const width of [390, 1280]) for (const theme of ["light", "dark"]) test(`resumes one ${kind} after reload at ${width} ${theme}`, async ({ page }, info) => {
 await page.setViewportSize({ width, height: 844 });
 let key = "", captureId = "", firstPartCalls = 0, secondPartCalls = 0, allocations = 0, completed = false, resume = false;
 const partSize = 5 * 1024 * 1024;
 const name = kind === "video" ? "walkthrough.mp4" : "room.png";
 await page.route("http://localhost:3995/**", async route => {
   const url = new URL(route.request().url());
   if (url.pathname.endsWith("presign-multipart")) {
     allocations++;
     const body = route.request().postDataJSON(); captureId = body.folder.split("/")[2];
     key = `${body.folder}/cleaner/${kind === "video" ? "video.mp4" : "room.jpg"}`;
     return route.fulfill({ json: { key, uploadId: "upload", partUrls: kind === "video" ? ["http://localhost:3995/storage/1", "http://localhost:3995/storage/2"] : ["http://localhost:3995/storage/1"] } });
   }
   if (url.pathname.endsWith("resume-multipart")) return route.fulfill({ json: { key, uploadId: "upload", partUrls: kind === "video" ? ["http://localhost:3995/storage/1", "http://localhost:3995/storage/2"] : ["http://localhost:3995/storage/1"], uploadedParts: kind === "video" ? [{ PartNumber: 1, ETag: "first", Size: partSize }] : [] } });
   if (url.pathname === "/storage/1") { firstPartCalls++; return route.fulfill(kind === "photo" && !resume ? { status: 503, body: "Temporary mobile outage" } : { headers: { etag: "first" }, body: "" }); }
   if (url.pathname === "/storage/2") { secondPartCalls++; return route.fulfill(resume ? { headers: { etag: "second" }, body: "" } : { status: 503, body: "Temporary mobile outage" }); }
   if (url.pathname.endsWith("complete-multipart")) {
     expect(route.request().postDataJSON().parts).toHaveLength(kind === "video" ? 2 : 1); completed = true;
     return route.fulfill({ json: { key, url: "/video.mp4" } });
   }
   if (url.pathname.endsWith("/evidence")) return route.fulfill(completed ? { json: { ok: true, key, captureId, media: { key, url: "/video.mp4", kind: kind === "video" ? "video" : "image" } } } : { status: 409, json: { error: "Video transfer is incomplete", code: "EVIDENCE_OBJECT_MISSING" } });
   if (url.pathname.startsWith("/api/")) throw new Error(`Unexpected API call: ${url.pathname}`);
   if (url.pathname === "/video.mp4") return route.fulfill({ contentType: "video/mp4", body: "" });
   return route.fulfill({ contentType: "text/html", body: `<html class="${theme === "dark" ? "dark" : ""}"><head><meta name="viewport" content="width=device-width,initial-scale=1"/><style>${css}</style></head><body><div id="root"></div><script>${bundle}</script></body></html>` });
 });
 await page.goto("http://localhost:3995/");
 // Deliberately undecodable bytes exercise the actual optional-compression fallback.
 await page.locator('input[type="file"]').last().setInputFiles(kind === "video" ? { name, mimeType: "video/mp4", buffer: Buffer.alloc(partSize + 3, 1) } : { name, mimeType: "image/png", buffer: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=", "base64") });
 await expect(page.getByRole("button", { name: `Retry upload: ${name}`, exact: true })).toBeVisible();
 await expect(page.getByTestId("attachments")).toHaveText("0");
 expect(firstPartCalls).toBe(kind === "video" ? 1 : 3); expect(secondPartCalls).toBe(kind === "video" ? 3 : 0);
 await page.reload();
 await expect(page.getByRole("button", { name: `Retry upload: ${name}`, exact: true })).toBeVisible();
 expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
 await page.screenshot({ path: info.outputPath(`${kind}-retry-${width}-${theme}.png`), fullPage: true });
 resume = true;
 await page.getByRole("button", { name: `Retry upload: ${name}`, exact: true }).focus();
 await page.keyboard.press("Enter");
 await expect(page.getByTestId("attachments")).toHaveText("1");
 expect(firstPartCalls).toBe(kind === "video" ? 1 : 4); expect(secondPartCalls).toBe(kind === "video" ? 4 : 0); expect(allocations).toBe(1);
 await expect(page.getByRole("button", { name: `Retry upload: ${name}`, exact: true })).toHaveCount(0);
});
