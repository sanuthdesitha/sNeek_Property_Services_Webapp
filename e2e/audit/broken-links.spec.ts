import { test, expect, Page } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

const MAX_DEPTH = 3;
const MAX_PAGES = 80;
const BLOCKED_PATTERNS = [
  /\/api\//,         // API routes
  /\/logout/,        // don't kill the session
  /^http/,           // external links
  /^mailto:/,
  /^tel:/,
];

interface CrawlResult {
  url: string;
  status: number | string;
  found_on: string;
  ok: boolean;
}

async function loginAsAdmin(page: Page) {
  await page.goto("/login");
  await page.fill("input#email", process.env.BASELINE_ADMIN_EMAIL ?? "admin@sneekproservices.com.au");
  await page.fill("input#password", process.env.BASELINE_ADMIN_PASSWORD ?? "admin123");
  await Promise.all([
    page.waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: 15_000 }),
    page.click("button[type=submit]"),
  ]);
}

function shouldSkip(href: string): boolean {
  return BLOCKED_PATTERNS.some((re) => re.test(href));
}

test.describe("broken links sweep @audit", () => {
  test.setTimeout(600_000);

  test("admin crawl finds no broken internal links", async ({ page }) => {
    await loginAsAdmin(page);

    const visited = new Set<string>();
    const queue: Array<{ url: string; depth: number; found_on: string }> = [
      { url: "/admin", depth: 0, found_on: "/" },
    ];
    const results: CrawlResult[] = [];

    while (queue.length > 0 && visited.size < MAX_PAGES) {
      const { url, depth, found_on } = queue.shift()!;
      if (visited.has(url)) continue;
      visited.add(url);

      let status: number | string = "unknown";
      try {
        const res = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 20_000 });
        status = res?.status() ?? "no-response";
        const ok = res?.ok() ?? false;
        results.push({ url, status, found_on, ok });

        if (ok && depth < MAX_DEPTH) {
          const hrefs = await page.$$eval("a[href]", (els) =>
            (els as HTMLAnchorElement[]).map((el) => el.getAttribute("href")).filter(Boolean) as string[]
          );
          for (const href of hrefs) {
            if (shouldSkip(href)) continue;
            const absolute = href.startsWith("/") ? href.split("#")[0].split("?")[0] : null;
            if (absolute && !visited.has(absolute)) {
              queue.push({ url: absolute, depth: depth + 1, found_on: url });
            }
          }
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        results.push({ url, status: `error: ${msg.slice(0, 80)}`, found_on, ok: false });
      }
    }

    const reportPath = path.join(process.cwd(), "docs", "audits", "broken-links-report.md");
    const broken = results.filter((r) => !r.ok);
    const lines: string[] = [];
    lines.push(`# Broken Links Report`);
    lines.push(``);
    lines.push(`Generated: ${new Date().toISOString()}`);
    lines.push(`Pages crawled: ${results.length}`);
    lines.push(`Broken: ${broken.length}`);
    lines.push(``);
    if (broken.length === 0) {
      lines.push(`No broken links found.`);
    } else {
      lines.push(`| URL | Status | Found on |`);
      lines.push(`|---|---|---|`);
      for (const r of broken) {
        lines.push(`| \`${r.url}\` | ${r.status} | \`${r.found_on}\` |`);
      }
    }
    lines.push(``);
    lines.push(`## All visits`);
    lines.push(``);
    lines.push(`<details><summary>${results.length} pages crawled</summary>`);
    lines.push(``);
    lines.push(`| URL | Status |`);
    lines.push(`|---|---|`);
    for (const r of results) {
      lines.push(`| \`${r.url}\` | ${r.status} |`);
    }
    lines.push(``);
    lines.push(`</details>`);
    fs.mkdirSync(path.dirname(reportPath), { recursive: true });
    fs.writeFileSync(reportPath, lines.join("\n"));

    if (broken.length > 0) {
      console.log(`Found ${broken.length} broken links. See docs/audits/broken-links-report.md`);
    }
    expect.soft(broken.length, "broken internal links").toBe(0);
  });
});
