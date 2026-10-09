import { test, expect } from "@playwright/test";
import { build } from "esbuild";
import fs from "node:fs/promises";
import path from "node:path";
import postcss from "postcss";
import tailwind from "tailwindcss";
let bundle: string, css: string;
test.beforeAll(async () => {
 bundle=(await build({entryPoints:[path.resolve("e2e/cleaner/fixtures/clock-wrapup-entry.tsx")],bundle:true,loader:{".css":"empty"},write:false,format:"iife",platform:"browser",jsx:"automatic",define:{"process.env":"{}","process.env.NODE_ENV":'"test"'},alias:{"@":process.cwd()}})).outputFiles[0].text;
 css=(await postcss([tailwind({config:path.resolve("tailwind.config.ts")})]).process(await fs.readFile("app/globals.css","utf8"),{from:"app/globals.css"})).css+await fs.readFile("app/v2/estate.css","utf8");
});
for (const width of [390, 1280]) for (const theme of ["light", "dark"]) test(`clock wrap-up ${width} ${theme}`, async ({page}, info) => {
 await page.setViewportSize({width,height:844});
 await page.route("http://localhost:3993/**", route => route.request().url().includes("/api/") ? route.fulfill({json:{requests:[]}}) : route.fulfill({contentType:"text/html",body:`<html class="${theme === "dark" ? "dark" : ""}"><head><style>${css}</style></head><body><div id="root"></div><script>${bundle}</script></body></html>`}));
 await page.goto("http://localhost:3993/");
 await expect(page.getByRole("button",{name:"Submit form",exact:true})).toBeEnabled();
 await expect(page.getByText(/keeps your recorded clock-out unchanged/)).toBeVisible();
 await page.getByRole("button",{name:"Submit form",exact:true}).focus();
 await page.keyboard.press("Enter");
 await expect(page.getByRole("status")).toHaveText("Form requested");
 expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
 await page.screenshot({path:info.outputPath(`wrapup-${width}-${theme}.png`),fullPage:true});
 await page.getByRole("button",{name:"Toggle clock"}).click();
 await expect(page.getByRole("button",{name:"Submit & clock out",exact:true})).toBeEnabled();
});
