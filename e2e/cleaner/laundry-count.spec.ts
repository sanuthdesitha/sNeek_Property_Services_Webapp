import { test, expect } from "@playwright/test";
import { build } from "esbuild";
import path from "node:path";
let bundle: string;
test.beforeAll(async () => {
  bundle = (await build({ entryPoints: [path.resolve("e2e/cleaner/fixtures/laundry-count-browser-entry.tsx")], bundle: true, write: false, format: "iife", platform: "browser", jsx: "automatic", logLevel: "silent",
    define: { "process.env.NODE_ENV": '"test"', "process.env": "{}" }, alias: { "@": process.cwd() }, plugins: [{ name: "synthetic-boundaries", setup(build) {
      build.onResolve({ filter: /^(next\/link|@\/components\/v2\/(cleaner\/(media-capture|use-submission-preflight)|admin\/estate-kit))$/ }, args => ({ path: args.path, namespace: "fixture" }));
      build.onLoad({ filter: /.*/, namespace: "fixture" }, args => ({ contents: args.path === "next/link" ? 'export default function Link(){return null}' : args.path.endsWith("media-capture") ? 'export const MediaCapture=()=>null' : args.path.endsWith("use-submission-preflight") ? 'export const useSubmissionPreflight=()=>[]' : 'export const EConfirmButton=()=>null' }));
    } }],
  })).outputFiles[0].text;
});
test("ready bags start unknown and the recorded confirmation count is read-only", async ({ page }) => {
  await page.route("**/__synthetic_laundry_count", route => route.fulfill({ contentType: "text/html", body: '<!doctype html><html><body><div id="root"></div></body></html>' }));
  await page.goto("/__synthetic_laundry_count"); await page.addScriptTag({ content: bundle });
  const count = page.getByRole("spinbutton", { name: "Bags ready (optional)" });
  await expect(count).toHaveValue(""); await expect(count).toBeEnabled();
  await count.fill("3"); await expect(count).toHaveValue("3");
  await page.getByRole("button", { name: "Load recorded confirmation fixture" }).click();
  await expect(count).toHaveValue("2"); await expect(count).toBeDisabled();
  await expect(page.getByText(/original ready count is retained/)).toBeVisible();
});
