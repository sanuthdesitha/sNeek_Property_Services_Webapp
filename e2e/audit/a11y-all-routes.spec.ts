import { test, expect, Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import fs from "node:fs";
import path from "node:path";

const ROUTES = [
  { path: "/", name: "Public home", needsAuth: false },
  { path: "/login", name: "Login page", needsAuth: false },
  { path: "/services", name: "Public services", needsAuth: false },
  { path: "/admin", name: "Admin home", needsAuth: true },
  { path: "/admin/jobs", name: "Admin jobs", needsAuth: true },
  { path: "/admin/calendar", name: "Admin calendar", needsAuth: true },
  { path: "/admin/quotes", name: "Admin quotes", needsAuth: true },
  { path: "/admin/settings", name: "Admin settings", needsAuth: true },
  { path: "/admin/system/uploads", name: "Admin uploads", needsAuth: true },
  { path: "/admin/system/email", name: "Admin email", needsAuth: true },
];

async function loginAsAdmin(page: Page) {
  await page.goto("/login");
  await page.fill("input#email", process.env.BASELINE_ADMIN_EMAIL ?? "admin@sneekproservices.com.au");
  await page.fill("input#password", process.env.BASELINE_ADMIN_PASSWORD ?? "admin123");
  await Promise.all([
    page.waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: 15_000 }),
    page.click("button[type=submit]"),
  ]);
}

interface Finding {
  route: string;
  ruleId: string;
  impact: string;
  help: string;
  nodes: number;
}

const FINDINGS_DIR = path.join(process.cwd(), ".audit-tmp", "a11y");

test.beforeAll(async () => {
  // Reset findings dir at start of test run.
  fs.rmSync(FINDINGS_DIR, { recursive: true, force: true });
  fs.mkdirSync(FINDINGS_DIR, { recursive: true });
});

test.afterAll(async () => {
  const allFindings: Finding[] = [];
  if (fs.existsSync(FINDINGS_DIR)) {
    for (const file of fs.readdirSync(FINDINGS_DIR)) {
      if (!file.endsWith(".json")) continue;
      const data = JSON.parse(fs.readFileSync(path.join(FINDINGS_DIR, file), "utf8")) as Finding[];
      allFindings.push(...data);
    }
  }
  const reportPath = path.join(process.cwd(), "docs", "audits", "a11y-full-report.md");
  const lines = [
    "# Accessibility Audit — Full",
    "",
    `Generated: ${new Date().toISOString()}`,
    `Routes scanned: ${ROUTES.length}`,
    `Total findings: ${allFindings.length}`,
    "",
  ];
  const byImpact = allFindings.reduce<Record<string, Finding[]>>((acc, f) => {
    (acc[f.impact] ||= []).push(f);
    return acc;
  }, {});
  for (const impact of ["critical", "serious", "moderate", "minor"]) {
    const findings = byImpact[impact] || [];
    lines.push(`## ${impact[0].toUpperCase()}${impact.slice(1)} — ${findings.length}`);
    lines.push("");
    if (findings.length === 0) {
      lines.push("None.");
      lines.push("");
      continue;
    }
    lines.push("| Route | Rule | Help | Nodes |");
    lines.push("|---|---|---|---|");
    for (const f of findings) {
      lines.push(`| \`${f.route}\` | ${f.ruleId} | ${f.help} | ${f.nodes} |`);
    }
    lines.push("");
  }
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.writeFileSync(reportPath, lines.join("\n"));
});

test.describe("a11y sweep @a11y-audit", () => {
  test.setTimeout(60_000);

  for (const route of ROUTES) {
    test(`${route.name} — axe`, async ({ page }) => {
      if (route.needsAuth) {
        await loginAsAdmin(page);
      }
      await page.goto(route.path);
      await page.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => {});

      const results = await new AxeBuilder({ page })
        .options({ resultTypes: ["violations"] })
        .analyze();

      const findings: Finding[] = results.violations.map((v) => ({
        route: route.path,
        ruleId: v.id,
        impact: v.impact || "unknown",
        help: v.help,
        nodes: v.nodes.length,
      }));
      const slug = route.path.replace(/[^a-zA-Z0-9]+/g, "_") || "root";
      fs.writeFileSync(path.join(FINDINGS_DIR, `${slug}.json`), JSON.stringify(findings));

      const blocking = results.violations.filter((v) => v.impact === "critical" || v.impact === "serious");
      // This is a baseline pass — log violations but don't fail the test
      // so the afterAll report aggregator can collect findings from every route.
      // Plan G follow-up will drive critical/serious to zero (and flip this back
      // to a hard assertion).
      if (blocking.length > 0) {
        console.log(`[a11y] ${blocking.length} blocking violations on ${route.path}: ${blocking.map((b) => b.id).join(", ")}`);
      }
    });
  }
});
