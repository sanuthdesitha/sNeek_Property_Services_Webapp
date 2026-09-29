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
