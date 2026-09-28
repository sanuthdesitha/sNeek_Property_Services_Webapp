import { test, expect } from "@playwright/test";
import { build } from "esbuild";
import fs from "node:fs/promises";
import path from "node:path";
import postcss from "postcss";
import tailwind from "tailwindcss";
let bundle: string, css: string;
test.beforeAll(async () => {
 bundle=(await build({entryPoints:[path.resolve("e2e/cleaner/fixtures/job-clean-ui-entry.tsx")],bundle:true,write:false,format:"iife",platform:"browser",jsx:"automatic",define:{"process.env":"{}","process.env.NODE_ENV":'"test"'},alias:{"@":process.cwd()}})).outputFiles[0].text;
 css=(await postcss([tailwind({config:path.resolve("tailwind.config.ts")})]).process(await fs.readFile("app/globals.css","utf8"),{from:"app/globals.css"})).css+await fs.readFile("app/v2/estate.css","utf8");
});
for(const width of [320,390,1440]) test(`cleaning fields remain usable without the top summary at ${width}px`,async({page},info)=>{
 await page.setViewportSize({width,height:800});
 await page.route("http://localhost:3993/**",route=>route.request().url().includes("/api/")?route.fulfill({json:{requests:[]}}):route.fulfill({contentType:"text/html",body:`<html><head><meta name="viewport" content="width=device-width,initial-scale=1"/><style>${css}</style></head><body><div id="root"></div><script>${bundle}</script></body></html>`}));
 await page.goto("http://localhost:3993/");
 await expect(page.getByText("Cleaning checklist",{exact:true})).toBeVisible();
 await expect(page.getByRole("navigation",{name:"Form room navigation"})).toHaveCount(0);
 await expect(page.getByText(/items to finish/)).toHaveCount(0);
 await expect(page.getByLabel("Kitchen note")).toBeVisible();
 await page.getByLabel("Kitchen note").fill("Kitchen cleaned");
 await expect(page.getByLabel("Kitchen note")).toHaveValue("Kitchen cleaned");
 expect(await page.evaluate(()=>Math.max(document.body.scrollWidth,document.documentElement.scrollWidth)-innerWidth)).toBeLessThanOrEqual(1);
 await page.screenshot({path:info.outputPath(`job-clean-${width}.png`),fullPage:true});
});
