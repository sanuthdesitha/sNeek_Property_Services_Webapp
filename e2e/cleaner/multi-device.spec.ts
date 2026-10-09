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
        path.resolve("e2e/cleaner/fixtures/multi-device-entry.tsx"),
      ],
      bundle: true,
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
test("separate devices share confirmed photos, assignment and removal; preview stays in-page", async ({
  browser,
}, info) => {
  const svg = `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200"><rect width="200" height="200" fill="#62766b"/><text x="50" y="105" fill="white">Room photo</text></svg>')}`;
  const photos = ["one", "two", "three"].map((name) => ({
    key: `forms/job/${name}/cleaner/photo.jpg`,
    url: svg,
    kind: "image",
    name,
  }));
  let pool = [...photos];
  const uploads: Record<string, typeof photos> = {};
  const receipts: Record<string, any> = Object.fromEntries(
    photos.map((photo) => [
      photo.key.split("/")[2],
      {
        key: photo.key,
        fieldId: "bulkPool",
        destination: { type: "bulkPool" },
        draftIdentity: "actor",
        formRevision: "revision",
        version: 0,
      },
    ]),
  );
  let reads = 0,
    writes = 0;
  const contexts = await Promise.all([
    browser.newContext(),
    browser.newContext(),
  ]);
  for (const context of contexts)
    await context.route("http://localhost:3994/**", async (route) => {
      const request = route.request();
      if (request.url().endsWith("/draft")) {
        reads++;
        return route.fulfill({
          json: {
            draft: {
              state: { bulkPool: pool, uploads },
              evidenceReceipts: receipts,
            },
          },
        });
      }
      if (request.url().endsWith("/evidence")) {
        const body = request.postDataJSON();
        const id = body.captureId ?? body.key.split("/")[2];
        const receipt = receipts[id];
        if (request.method() === "DELETE") {
          receipt.detached = true;
          pool = pool.filter((photo) => photo.key !== body.key);
          for (const field of Object.keys(uploads))
            uploads[field] = uploads[field].filter(
              (photo) => photo.key !== body.key,
            );
          return route.fulfill({ json: { ok: true, key: body.key } });
        }
        if (receipt.version !== body.move.version)
          return route.fulfill({
            status: 409,
            json: { error: "Photo changed on another device" },
          });
        writes++;
        receipt.version++;
        receipt.destination = body.destination;
        const photo = photos.find((photo) => photo.key === body.key)!;
        pool = pool.filter((row) => row.key !== body.key);
        uploads[body.destination.fieldId] = [
          ...(uploads[body.destination.fieldId] ?? []),
          photo,
        ];
        return route.fulfill({
          json: {
            ok: true,
            captureId: id,
            key: body.key,
            version: receipt.version,
            destination: body.destination,
          },
        });
      }
      return route.fulfill({
        contentType: "text/html",
        body: '<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><div id="root"></div>',
      });
    });
  const pages = await Promise.all(contexts.map((context) => context.newPage()));
  for (const page of pages) {
    await page.goto("http://localhost:3994/");
    await page.addStyleTag({ content: css });
    await page.addScriptTag({ content: bundle });
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await expect(
      page.getByRole("checkbox", { name: "Select one", exact: true }),
    ).toBeVisible();
  }
  const [first, second] = pages;
  for (const width of [390, 1280])
    for (const dark of [false, true]) {
      await first.setViewportSize({ width, height: 900 });
      await first.evaluate(
        (dark) => document.documentElement.classList.toggle("dark", dark),
        dark,
      );
      await first
        .getByRole("button", { name: "Preview one", exact: true })
        .click();
      await expect(
        first.getByRole("dialog", { name: "one", exact: true }),
      ).toBeVisible();
      expect(contexts[0].pages()).toHaveLength(1);
      await first.screenshot({
        path: info.outputPath(`preview-${width}-${dark}.png`),
      });
      await first.getByRole("button", { name: "Close preview" }).click();
      expect(
        await first.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth + 1,
        ),
      ).toBe(true);
      await first.screenshot({
        path: info.outputPath(`bulk-${width}-${dark}.png`),
      });
    }
  const beforeReads = reads;
  for (const name of ["one", "two", "three"])
    await first
      .getByRole("checkbox", { name: `Select ${name}`, exact: true })
      .click();
  await first.getByRole("button", { name: "Assign to…", exact: true }).click();
  await first
    .getByRole("button", { name: /Kitchen photos/ })
    .last()
    .click();
  await expect(first.getByText("Unassigned: 0")).toBeVisible();
  expect(writes).toBe(3);
  expect(reads - beforeReads).toBeLessThanOrEqual(2);
  await second.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(second.getByText("Unassigned: 0")).toBeVisible();
  second.on("dialog", (dialog) => dialog.accept());
  await second
    .getByRole("checkbox", { name: "Select one", exact: true })
    .click();
  await second.getByRole("button", { name: "Remove selected" }).click();
  await expect(
    second.getByRole("checkbox", { name: "Select one", exact: true }),
  ).toHaveCount(0);
  await first.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(
    first.getByRole("checkbox", { name: "Select one", exact: true }),
  ).toHaveCount(0);
  for (const context of contexts) await context.close();
});
