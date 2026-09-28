import { test, expect } from "@playwright/test";
import { build } from "esbuild";
import fs from "node:fs/promises";
import path from "node:path";
import postcss from "postcss";
import tailwind from "tailwindcss";
let bundle: string, css: string;
test.beforeAll(async () => {
  bundle = (await build({ entryPoints: [path.resolve("e2e/admin/fixtures/shopping-charges-entry.tsx")], bundle: true, write: false, format: "iife", platform: "browser", jsx: "automatic", define: { "process.env": "{}", "process.env.NODE_ENV": '"test"' }, alias: { "@": process.cwd(), "next-auth/react": path.resolve("e2e/admin/fixtures/property-memory-session.ts") } })).outputFiles[0].text;
  css = (await postcss([tailwind({ config: path.resolve("tailwind.config.ts") })]).process(await fs.readFile("app/globals.css", "utf8"), { from: "app/globals.css" })).css + await fs.readFile("app/v2/estate.css", "utf8");
});
for (const width of [320,390,1440]) test(`billing review distinguishes saved values and preview at ${width}px`, async ({page}, info) => {
 await page.setViewportSize({width,height:900});
 let charge = {id:"charge",revision:1,expenseAmount:12,expenseBillable:true,shoppingMinutes:30,allocatedMinutes:30,hourlyRate:null as number|null,labourAmount:0,treatment:"PENDING",status:"DRAFT",invoiceId:null,reviewNote:null,property:{name:"Harbourside apartment with a long property name"},client:{name:"Client property portfolio"}};
 let requests = 0;
 await page.route("http://localhost:3996/**", async route => {
  if(route.request().url().includes("/api/")) {
   if(route.request().method()==="PATCH") { requests++;const body=route.request().postDataJSON();charge={...charge,revision:2,hourlyRate:body.hourlyRate,treatment:body.treatment,status:body.status,labourAmount:50};return route.fulfill({json:{ok:true}}); }
   return route.fulfill({json:{charges:[charge]}});
  }
  return route.fulfill({contentType:"text/html",body:`<html><head><meta name="viewport" content="width=device-width, initial-scale=1"/><style>:root{--font-sans:Arial;--font-estate-serif:Georgia;--font-mono:monospace}${css}</style></head><body><div id="root"></div><script>${bundle}</script></body></html>`});
 });
 await page.goto("http://localhost:3996/");
 await page.getByLabel("Client rate for charge").fill("100");
 await expect(page.getByText(/Unsaved labour preview/)).toContainText("$50.00");
 await expect(page.getByText(/Purchases:.*Time charge:/)).toContainText("$0.00");
 await page.getByLabel("Treatment for charge").selectOption("RECHARGE");
 expect(await page.evaluate(() => Math.max(document.body.scrollWidth,document.querySelector('main')!.scrollWidth)-innerWidth)).toBeLessThanOrEqual(1);
 await page.screenshot({path:info.outputPath(`charge-review-${width}.png`),fullPage:true});
 await page.getByRole("button",{name:"Approve for next invoice"}).click();
 await expect(page.getByText("Approved for the next invoice")).toBeVisible();
 expect(requests).toBe(1);
 await expect(page.getByText(/Purchases:.*Time charge:/)).toContainText("$50.00");
});
