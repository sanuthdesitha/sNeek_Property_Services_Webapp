import {test,expect} from "@playwright/test";
import {build} from "esbuild";
import fs from "node:fs/promises";
import path from "node:path";
import postcss from "postcss";
import tailwind from "tailwindcss";
let bundle:string,css:string;
test.beforeAll(async()=>{bundle=(await build({entryPoints:[path.resolve("e2e/cleaner/fixtures/failed-upload-entry.tsx")],bundle:true,write:false,format:"iife",platform:"browser",jsx:"automatic",define:{"process.env.NODE_ENV":'"test"'},alias:{"@":process.cwd()}})).outputFiles[0].text;css=(await postcss([tailwind({config:path.resolve("tailwind.config.ts")})]).process(await fs.readFile("app/globals.css","utf8"),{from:"app/globals.css"})).css+await fs.readFile("app/v2/estate.css","utf8");});
for(const width of [320,390,1440])test(`failed attempt clears active UI at ${width}`,async({page},info)=>{
 await page.setViewportSize({width,height:780});let calls=0;
 await page.route("http://localhost:3994/**",async route=>{if(route.request().url().includes("/api/uploads/direct")){calls++;return calls===1?route.fulfill({status:400,json:{error:"File could not be uploaded"}}):route.fulfill({json:{key:"new.pdf",url:"/new.pdf"}});}return route.fulfill({contentType:"text/html",body:`<html><head><meta name="viewport" content="width=device-width,initial-scale=1"/><style>${css}</style></head><body><div id="root"></div><script>${bundle}</script></body></html>`});});
 await page.goto("http://localhost:3994/");await page.locator('input[type="file"]').setInputFiles({name:"report.pdf",mimeType:"application/pdf",buffer:Buffer.from("original")});
 await expect(page.getByText(/1 file did not upload. Choose the file again/)).toBeVisible();await expect(page.getByTestId("attachments")).toHaveText("1");await expect(page.getByRole("button",{name:"Remove failed upload"})).toHaveCount(0);await expect(page.getByRole("button",{name:"Save original: report.pdf"})).toBeVisible();expect(calls).toBe(1);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth-innerWidth)).toBeLessThanOrEqual(1);await page.screenshot({path:info.outputPath(`failed-upload-${width}.png`),fullPage:true});
 await page.locator('input[type="file"]').setInputFiles({name:"report.pdf",mimeType:"application/pdf",buffer:Buffer.from("original")});await expect(page.getByTestId("attachments")).toHaveText("2");expect(calls).toBe(2);await expect(page.getByText(/Choose the file again/)).toHaveCount(0);
});


for (const width of [390,1280]) for (const theme of ["light","dark"]) for (const kind of ["photo","video"]) {
 test(`saved ${kind} retries after attachment timeout at ${width} in ${theme}`, async ({page},info) => {
  await page.setViewportSize({width,height:800});
  await page.clock.install();
  let allocations=0,parts=0,attachments=0,allocatedKey="";
  await page.route("http://localhost:3994/**", async route => {
   const request=route.request(),url=new URL(request.url());
   if(url.pathname.endsWith("presign-multipart")) {
    allocations++;
    const body=request.postDataJSON();
    allocatedKey=`${body.folder}/fixture-cleaner/saved.${kind === "photo" ? "png" : "mp4"}`;
    return route.fulfill({json:{key:allocatedKey,uploadId:"fixture-upload",partUrls:["http://localhost:3994/storage-part"]}});
   }
   if(url.pathname === "/storage-part") {parts++;return route.fulfill({headers:{etag:"fixture-etag"},body:""});}
   if(url.pathname.endsWith("complete-multipart")) return route.fulfill({json:{key:allocatedKey,url:"/verified-media"}});
   if(url.pathname.endsWith("/evidence")) {
    attachments++;
    if(attachments === 1) return; // Deliberately stalled response; browser deadline must release it.
    const body=request.postDataJSON();
    return route.fulfill({json:{ok:true,key:allocatedKey,captureId:body.captureId,media:{key:allocatedKey,url:"/verified-media",kind:kind === "photo" ? "image" : "video"}}});
   }
   if(url.pathname.startsWith("/api/") || url.pathname === "/verified-media" || url.pathname === "/saved.pdf") return route.fulfill({status:404,body:"fixture only"});
   return route.fulfill({contentType:"text/html",body:`<html class="${theme === "dark" ? "dark" : ""}"><head><meta name="viewport" content="width=device-width,initial-scale=1"/><style>${css}</style></head><body><div id="root"></div><script>${bundle}</script></body></html>`});
  });
  await page.goto("http://localhost:3994/?durable");
  const buffer=kind === "photo" ? Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAIAAABLbSncAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAEUlEQVR4nGMwqViFFTEMLQkASzdVgah4Uf8AAAAASUVORK5CYII=","base64") : Buffer.from("unsupported-codec-original-fixture");
  await page.locator('input[type="file"]').setInputFiles({name:kind === "photo" ? "photo.png" : "clip.mp4",mimeType:kind === "photo" ? "image/png" : "video/mp4",buffer});
  await expect.poll(()=>attachments).toBe(1);
  await page.clock.runFor(30_001);
  await expect(page.getByText(/1 file did not upload. Retry the saved upload/)).toBeVisible();
  await expect(page.getByTestId("attachments")).toHaveText("1");
  await expect(page.getByRole("button",{name:/Save original:/})).toBeEnabled();
  const retry=page.getByRole("button",{name:/^Retry upload:/});
  await expect(retry).toBeEnabled();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth-innerWidth)).toBeLessThanOrEqual(1);
  await page.screenshot({path:info.outputPath(`${kind}-timeout-${width}-${theme}.png`),fullPage:true});
  await retry.focus();await page.keyboard.press("Enter");
  await expect(page.getByTestId("attachments")).toHaveText("2");
  expect(allocations).toBe(1);expect(parts).toBe(1);expect(attachments).toBe(2);
  await expect(page.getByText(/1 file did not upload/)).toHaveCount(0);
 });
}
