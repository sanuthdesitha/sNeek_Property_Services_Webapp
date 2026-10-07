import { test, expect } from "@playwright/test";
import { build } from "esbuild";
import fs from "node:fs/promises";
import path from "node:path";
import postcss from "postcss";
import tailwind from "tailwindcss";
let bundle: string, css: string;
const key = "forms/old-job/capture/cleaner/photo.jpg";
const row = { key, name: "Old photo", previewUrl: "/fixture.svg", version: "a".repeat(64), removed: false, issues: ["Stored under another job", "Captured under an older or different form version"], source: { jobId: "old-job", captureId: "capture", userId: "cleaner", legacy: false }, locations: [{ type: "bulkPool" }], receipts: [{ id: "capture", formRevision: "old-form-version", draftIdentity: "old-context" }] };
test.beforeAll(async () => {
  bundle = (await build({ entryPoints: [path.resolve("e2e/cleaner/fixtures/draft-evidence-review-entry.tsx")], bundle: true, write: false, format: "iife", platform: "browser", jsx: "automatic", define: { "process.env": "{}", "process.env.NODE_ENV": '"test"' }, alias: { "@": process.cwd(), "@/components/v2/cleaner/media-capture": path.resolve("e2e/cleaner/fixtures/bulk-auto-upload.ts") } })).outputFiles[0].text;
  css = (await postcss([tailwind({ config: path.resolve("tailwind.config.ts") })]).process(await fs.readFile("app/globals.css", "utf8"), { from: "app/globals.css" })).css + await fs.readFile("app/v2/estate.css", "utf8");
});

for (const width of [320, 390, 1440]) test(`compact office batch selection and partial failure at ${width}px`, async ({ page }, info) => {
 await page.setViewportSize({width,height:850});
 const removed = new Set<string>(); const writes: any[] = []; let failed=false;
 const rows=Array.from({length:18},(_,i)=>({...row,key:i===0?key:"key-"+i,name:"Photo "+i,issues:i%2?["Different account context"]:row.issues}));
 await page.route("http://localhost:3999/**",async route=>{
  if(route.request().url().endsWith("/evidence-review")){
   if(route.request().method()==="POST"){
    const body=route.request().postDataJSON(); writes.push(body);
    if(body.key==="key-1"&&!failed){failed=true;return route.fulfill({status:503,json:{error:"Audit unavailable. Retry."}});}
    removed.add(body.key);return route.fulfill({json:{ok:true,key:body.key,discardedReference:true}});
   }
   return route.fulfill({json:{jobId:"job",locked:false,rows:rows.map(r=>({...r,removed:removed.has(r.key)})),history:[]}});
  }
  if(route.request().url().endsWith("/fixture.svg"))return route.fulfill({contentType:"image/svg+xml",body:'<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128"><rect width="128" height="128" fill="#809c92"/></svg>'});
  return route.fulfill({contentType:"text/html",body:'<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><div id="root"></div>'});
 });
 const open=async()=>{await page.goto("http://localhost:3999/office");await page.addStyleTag({content:css});await page.addScriptTag({content:bundle});await expect(page.getByText("18 active · 18 need review")).toBeVisible();};
 await open();
 expect((await page.locator("#draft-evidence-review").boundingBox())!.height).toBeLessThan(100);
 await page.screenshot({path:info.outputPath(`office-collapsed-${width}.png`),fullPage:true});
 await page.getByRole("button",{name:/Draft evidence review/}).click();
 await expect(page.getByRole("checkbox")).toHaveCount(9);
 const select=page.getByRole("checkbox",{name:"Select Photo 0",exact:true});
 expect((await select.locator("..").boundingBox())!.height).toBeGreaterThanOrEqual(44);
 await select.check();await page.getByRole("checkbox",{name:"Select Photo 1",exact:true}).check();
 await page.getByRole("textbox").fill("Photo belongs to the older job.");
 expect(await page.evaluate(()=>document.documentElement.scrollWidth-innerWidth)).toBeLessThanOrEqual(1);
 expect(await page.locator("#draft-evidence-review").evaluate(el=>getComputedStyle(el).fontSize)).toBe("13px");
 await page.screenshot({path:info.outputPath(`office-batch-${width}.png`),fullPage:true});
 const button=page.getByRole("button",{name:"Discard 2 selected"});
 page.once("dialog",d=>d.dismiss());await button.click();expect(writes).toHaveLength(0);
 page.once("dialog",d=>d.accept());await button.click();
 await expect(page.getByRole("alert")).toContainText("1 of 2 confirmed");
 await expect(page.getByRole("checkbox",{name:"Select Photo 1",exact:true})).toBeChecked();
 await expect(page.getByRole("textbox")).toHaveValue("Photo belongs to the older job.");
 page.once("dialog",d=>d.accept());await page.getByRole("button",{name:"Discard 1 selected"}).click();
 await expect(page.getByRole("textbox")).toHaveCount(0);
 expect(writes.map(w=>w.key)).toEqual([key,"key-1","key-1"]);
 expect(writes.every(w=>w.reason==="Photo belongs to the older job.")).toBe(true);
 await page.getByRole("button",{name:"Refresh"}).click();
 await expect(page.getByRole("checkbox",{name:"Select Photo 0",exact:true})).toHaveCount(0);
});
test("cleaner separately confirms a wrong reference while the original capture remains intact", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 850 }); const writes: any[] = [];
  await page.route("http://localhost:3999/**", async route => {
    if (route.request().url().endsWith("/evidence")) {
      const body = route.request().postDataJSON(); writes.push(body);
      return body.discardReference ? route.fulfill({ json: { ok: true, key, discardedReference: true } }) : route.fulfill({ status: 409, json: { code: "EVIDENCE_CONTEXT_MISMATCH", canDiscardReference: true, error: "Different capture context" } });
    }
    return route.fulfill({ contentType: "text/html", body: '<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><div id="root"></div>' });
  });
  await page.goto("http://localhost:3999/cleaner"); await page.addStyleTag({ content: css }); await page.addScriptTag({ content: bundle });
  await page.getByRole("checkbox", { name: "Select Old photo" }).check();
  page.once("dialog", dialog => dialog.accept()); await page.getByRole("button", { name: "Remove selected" }).click();
  const discard = page.getByRole("button", { name: "Discard wrong draft reference" }); await expect(discard).toBeVisible();
  const box = await discard.boundingBox(); expect(box!.height).toBeGreaterThanOrEqual(44);
  page.once("dialog", dialog => dialog.dismiss()); await discard.click(); expect(writes).toHaveLength(1);
  page.once("dialog", dialog => dialog.accept()); await discard.click(); await expect(page.getByText("Unassigned: 0")).toBeVisible();
  expect(writes).toHaveLength(2); expect(writes[1]).toMatchObject({ discardReference: true, key, reason: expect.stringContaining("does not belong") });
});
