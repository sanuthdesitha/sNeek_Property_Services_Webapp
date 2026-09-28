import { test, expect } from "@playwright/test";
import { build } from "esbuild";
import fs from "node:fs/promises";
import path from "node:path";
import postcss from "postcss";
import tailwind from "tailwindcss";
let bundle: string, css: string;
test.beforeAll(async () => {
  bundle = (await build({ entryPoints: [path.resolve("e2e/admin/fixtures/ollama-settings-entry.tsx")], bundle: true, write: false, format: "iife", platform: "browser", jsx: "automatic", define: { "process.env": "{}", "process.env.NODE_ENV": '"test"' }, alias: { "@": process.cwd(), "next-auth/react": path.resolve("e2e/admin/fixtures/property-memory-session.ts") } })).outputFiles[0].text;
  css = (await postcss([tailwind({ config: path.resolve("tailwind.config.ts") })]).process(await fs.readFile("app/globals.css", "utf8"), { from: "app/globals.css" })).css + await fs.readFile("app/v2/estate.css", "utf8");
});
for (const width of [320,390,1440]) test(`Ollama setup and independent diagnostics at ${width}px`,async ({page},info)=>{
 await page.setViewportSize({width,height:900});
 let settings={baseUrl:"http://ollama:11434",textModel:"text:latest",visionModel:"gemma3:4b",useForText:false,contextTokens:4096,inferenceTimeoutSeconds:180,keepAliveMinutes:5,hasApiKey:true};
 const checks:string[]=[];
 await page.route("http://localhost:3997/**",async route=>{
  const request=route.request();
  if(request.url().includes("/api/")) {
   if(request.url().endsWith("/check")){const check=request.postDataJSON().check;checks.push(check);return route.fulfill({json:{check,ok:check!=="text",message:check==="text"?"Selected text model is not installed.":`${check} verified`,checkedAt:"2026-09-28T00:00:00Z",durationMs:120, ...(check==="connection"?{models:[{name:"gemma3:4b",size:3e9}],running:[],version:"0.17.0"}:{})}});}
   if(request.url().endsWith("/pull"))return route.fulfill({contentType:"application/x-ndjson",body:'{"status":"pulling","completed":50,"total":100}\n{"status":"success"}\n'});
   if(request.method()==="PATCH")settings={...settings,...request.postDataJSON(),hasApiKey:true};
   return route.fulfill({json:{settings}});
  }
  return route.fulfill({contentType:"text/html",body:`<html><head><meta name="viewport" content="width=device-width, initial-scale=1"/><style>:root{--font-sans:Arial;--font-estate-serif:Georgia;--font-mono:monospace}${css}</style></head><body><div id="root"></div><script>${bundle}</script></body></html>`});
 });
 await page.goto("http://localhost:3997/");
 await page.getByLabel("Text model",{exact:true}).fill("text:small");
 await expect(page.getByRole("button",{name:"Check all"})).toBeDisabled();
 await page.getByRole("button",{name:"Save Ollama settings"}).click();
 await page.getByRole("button",{name:"Check all"}).click();
 await expect(page.getByText("comparison verified")).toBeVisible();
 expect(checks).toEqual(["connection","text","assignment","comparison"]);
 await expect(page.getByText(/3 of 4 checks passed/)).toBeVisible();
 await expect(page.getByText("Selected text model is not installed.")).toBeVisible();
 await page.getByText("Model performance settings",{exact:true}).click();
 expect(await page.evaluate(()=>Math.max(document.body.scrollWidth,document.querySelector('main')!.scrollWidth)-innerWidth)).toBeLessThanOrEqual(1);
 await page.screenshot({path:info.outputPath(`ollama-settings-${width}.png`),fullPage:true});
 await page.getByLabel("Model to download").fill("gemma3:4b");await page.getByRole("button",{name:"Download model"}).click();
 await expect(page.getByText(/Model downloaded/)).toBeVisible();
 await expect(page.getByLabel("Vision model")).toHaveValue("gemma3:4b");
});
