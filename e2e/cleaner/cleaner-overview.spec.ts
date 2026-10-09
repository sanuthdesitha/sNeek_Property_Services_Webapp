import { test, expect } from "@playwright/test";
import { build } from "esbuild";
import fs from "node:fs/promises";
import path from "node:path";
import postcss from "postcss";
import tailwind from "tailwindcss";
let bundle: string, css: string;
test.beforeAll(async () => {
  bundle = (
    await build({
      entryPoints: [
        path.resolve("e2e/cleaner/fixtures/cleaner-overview-entry.tsx"),
      ],
      bundle: true,
      loader: { ".css": "empty" },
      write: false,
      format: "iife",
      platform: "browser",
      jsx: "automatic",
      define: { "process.env": "{}", "process.env.NODE_ENV": '"test"' },
      alias: { "@": process.cwd() },
    })
  ).outputFiles[0].text;
  css =
    (
      await postcss([
        tailwind({ config: path.resolve("tailwind.config.ts") }),
      ]).process(await fs.readFile("app/globals.css", "utf8"), {
        from: "app/globals.css",
      })
    ).css + (await fs.readFile("app/v2/estate.css", "utf8"));
});
for (const width of [390, 1280])
  for (const dark of [false, true])
    test(`cleaner overview and setup ${width} ${dark}`, async ({
      page,
    }, info) => {
      await page.setViewportSize({ width, height: 900 });
      await page.route("http://localhost:3995/**", (route) => {
        const url = route.request().url();
        if (url.includes("/property-access/"))
          return route.fulfill({
            json: {
              accessGuide: [
                {
                  id: "entry",
                  title: "Front entrance",
                  label: "Front entrance",
                  instructions: "Use the main entrance",
                  text: "Use the main entrance",
                  type: "TEXT",
                },
              ],
            },
          });
        if (url.includes("/laundry-eta"))
          return route.fulfill({
            json: { state: "delivered", droppedAt: "2026-10-08T05:00:00Z" },
          });
        if (url.includes("/briefing"))
          return route.fulfill({
            json: {
              day: "today",
              dateLabel: "Friday 9 October",
              jobsOverview: { count: 1, jobs: [] },
              reminders: {
                deviceLine:
                  "Charge Ring camera and Minut devices on every clean and upload charging proof.",
                expiringDocuments: [],
              },
            },
          });
        return route.fulfill({
          contentType: "text/html",
          body: '<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><div id="root"></div>',
        });
      });
      await page.goto("http://localhost:3995/");
      await page.addStyleTag({ content: css });
      await page.evaluate(
        (dark) => document.documentElement.classList.toggle("dark", dark),
        dark,
      );
      await page.addScriptTag({ content: bundle });
      await expect(page.getByText("Friday 9 Oct 2026 · 09:00")).toBeVisible();
      await expect(
        page.getByRole("link", { name: "Start driving" }),
      ).toHaveAttribute("href", "/v2/cleaner/route?jobId=job");
      await expect(page.getByText(/Property setup reference/)).toHaveCount(0);
      await page.getByRole("button", { name: "Step 2", exact: true }).click();
      await expect(page.getByText(/Property setup reference/)).toBeVisible();
      await page.getByRole("button", { name: "Step 3", exact: true }).click();
      await expect(page.getByText(/Property setup reference/)).toBeVisible();
      await expect(page.getByText("Outdated duplicate linen note")).toHaveCount(
        0,
      );
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth + 1,
        ),
      ).toBe(true);
      await page.screenshot({
        path: info.outputPath(`setup-${width}-${dark}.png`),
        fullPage: true,
      });
    });
