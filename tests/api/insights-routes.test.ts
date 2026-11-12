// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { allOpsLevels } from "@/lib/rbac/ops-catalog";
import { deriveJobFact } from "@/lib/insights/job-facts";
import { context, jobRow } from "../lib/insights-fixtures";

const m = vi.hoisted(() => ({
  role: vi.fn(),
  ops: vi.fn(),
  facts: vi.fn(),
  issues: vi.fn(),
  receivables: vi.fn(),
}));
vi.mock("@/lib/auth/session", () => ({ requireRole: m.role }));
vi.mock("@/lib/rbac/ops-access", () => ({ getOpsAccess: m.ops }));
vi.mock("@/lib/insights/load-facts", () => ({
  loadJobFacts: m.facts,
  loadIssueCounts: m.issues,
  loadCategoryLabelMap: vi.fn().mockResolvedValue(new Map()),
  loadPeopleNames: vi.fn().mockResolvedValue(new Map([["cleaner-1", "Ana"]])),
  loadClientOptions: vi.fn().mockResolvedValue([]),
}));
vi.mock("@/lib/insights/receivables", async () => {
  const actual = await vi.importActual<typeof import("@/lib/insights/receivables")>("@/lib/insights/receivables");
  return { ...actual, loadReceivablesFacts: m.receivables };
});

import { GET as business } from "@/app/api/admin/insights/business/route";
import { GET as clients } from "@/app/api/admin/insights/clients/route";
import { GET as properties } from "@/app/api/admin/insights/properties/route";
import { GET as exportCsv } from "@/app/api/admin/insights/export/route";

const request = (path: string) => new NextRequest(`http://localhost${path}`);
const FINANCE_KEYS = ["revenue", "margin", "cleanerCost", "money", "weekly", "payment", "daysToPay", "overdueAud"];

function collectKeys(value: unknown, keys = new Set<string>()): Set<string> {
  if (Array.isArray(value)) value.forEach((item) => collectKeys(item, keys));
  else if (value && typeof value === "object") {
    for (const [key, child] of Object.entries(value)) {
      if (child !== null && child !== undefined) keys.add(key);
      collectKeys(child, keys);
    }
  }
  return keys;
}

beforeEach(() => {
  vi.clearAllMocks();
  m.role.mockResolvedValue({ user: { id: "o", role: "OPS_MANAGER" } });
  m.facts.mockResolvedValue(Array.from({ length: 6 }, (_, i) => deriveJobFact(jobRow({ id: `j${i}` }), context)));
  m.issues.mockResolvedValue({ total: 0, byProperty: new Map(), byCleaner: new Map(), byCategory: new Map() });
  m.receivables.mockResolvedValue({
    paymentTermsDays: 14,
    paid: [
      { clientId: "client-1", days: { value: 40, reason: null } },
      { clientId: "client-1", days: { value: 30, reason: null } },
    ],
    clientNames: new Map([["client-1", "Northside Lets"]]),
    overdueByClient: new Map([["client-1", { owing: 2310, count: 2 }]]),
  });
});

describe("Insights API access", () => {
  it("uses the live role guard for ADMIN and OPS_MANAGER only and maps refusals", async () => {
    m.ops.mockResolvedValue(null);
    expect((await business(request("/api/admin/insights/business"))).status).toBe(200);
    expect(m.role).toHaveBeenCalledWith(["ADMIN", "OPS_MANAGER"]);
    m.role.mockRejectedValue(new Error("FORBIDDEN"));
    expect((await business(request("/api/admin/insights/business"))).status).toBe(403);
    expect(m.facts).toHaveBeenCalledTimes(2);
    m.role.mockRejectedValue(new Error("UNAUTHORIZED"));
    expect((await clients(request("/api/admin/insights/clients"))).status).toBe(401);
  });

  it("refuses a malformed period instead of answering another one", async () => {
    m.ops.mockResolvedValue(null);
    const response = await business(request("/api/admin/insights/business?period=custom&from=2026-10-10&to=2026-10-01"));
    expect(response.status).toBe(400);
  });

  it("gives an admin the money figures, the weekly chart and the payment finding", async () => {
    m.ops.mockResolvedValue(null);
    const body = await (await business(request("/api/admin/insights/business?period=last-month"))).json();
    expect(body.access).toEqual({ finance: true });
    expect(body.cards.revenue.value).toBe(900);
    expect(body.cards.margin.value).toBe(40);
    expect(body.weekly.length).toBeGreaterThan(0);
    expect(body.findings.map((finding: { detector: string }) => finding.detector)).toContain("slow_payer");
  });

  it("omits every financial field server-side for an operations manager without finance", async () => {
    m.ops.mockResolvedValue({ ...allOpsLevels("manage"), finance: "off" });
    const body = await (await business(request("/api/admin/insights/business?period=last-month"))).json();
    expect(body.access).toEqual({ finance: false });
    const keys = collectKeys(body);
    for (const key of FINANCE_KEYS) expect(keys.has(key)).toBe(false);
    expect(body.cards.onTime.value).toBe(100);
    expect(body.cards.hoursRatio.value).toBe(111.1);
    expect(m.receivables).not.toHaveBeenCalled();

    const clientBody = await (await clients(request("/api/admin/insights/clients"))).json();
    const clientKeys = collectKeys(clientBody);
    for (const key of FINANCE_KEYS) expect(clientKeys.has(key)).toBe(false);
    expect(clientBody.rows[0].figures.cleans).toBe(6);

    expect((await properties(request("/api/admin/insights/properties?sort=margin"))).status).toBe(400);

    const csv = await (await exportCsv(request("/api/admin/insights/export?tab=properties"))).text();
    expect(csv.split("\r\n")[0]).not.toMatch(/Revenue|Margin|cost/);
  });

  it("allows finance at read level", async () => {
    m.ops.mockResolvedValue({ ...allOpsLevels("off"), reports: "read", finance: "read" });
    const body = await (await clients(request("/api/admin/insights/clients?sort=overdue&dir=desc"))).json();
    expect(body.rows[0].payment).toMatchObject({ overdueAud: 2310, daysToPay: { value: 35, basisCount: 2 } });
  });

  it("exports the current tab as CSV and refuses an unknown tab", async () => {
    m.ops.mockResolvedValue(null);
    const response = await exportCsv(request("/api/admin/insights/export?tab=properties&period=last-month"));
    expect(response.headers.get("content-type")).toContain("text/csv");
    expect(response.headers.get("content-disposition")).toContain("insights-properties-2026-");
    expect((await exportCsv(request("/api/admin/insights/export?tab=pdfs"))).status).toBe(400);
  });
});

describe("Insights design completion (Wave C)", () => {
  it("states the overrun's money per clean for finance access and leaves it out server-side otherwise", async () => {
    m.ops.mockResolvedValue(null);
    const body = await (await business(request("/api/admin/insights/business?period=last-month"))).json();
    const overrun = body.findings.find((finding: { detector: string }) => finding.detector === "property_overrun");
    // Six cleans at $150 charge and $90 pay, 20 minutes over plan each.
    expect(overrun.detail).toBe("6 of 6 cleans went over. At the current rate this property makes $60 per clean.");
    expect(overrun.basis).toContain("over 6 cleans with both");

    m.ops.mockResolvedValue({ ...allOpsLevels("manage"), finance: "off" });
    const bare = await (await business(request("/api/admin/insights/business?period=last-month"))).json();
    const plain = bare.findings.find((finding: { detector: string }) => finding.detector === "property_overrun");
    expect(plain.detail).toBe("6 of 6 cleans went over.");
    expect(JSON.stringify(bare)).not.toMatch(/per clean|marginPerClean/);
    expect(bare.properties.order).toEqual({ sort: "ratio", dir: "desc" });
  });

  it("serves the preview's top five for any order from the whole property set", async () => {
    m.ops.mockResolvedValue(null);
    m.facts.mockResolvedValue(
      Array.from({ length: 8 }, (_, p) =>
        Array.from({ length: p + 1 }, (_, c) =>
          deriveJobFact(jobRow({ id: `p${p}-${c}`, propertyId: `prop-${p}`, property: { name: `Home ${p}`, clientId: "client-1", client: { name: "Northside Lets" } } }), context),
        ),
      ).flat(),
    );
    const most = await (await properties(request("/api/admin/insights/properties?period=last-month&sort=cleans&dir=desc&page=1&pageSize=5"))).json();
    expect(most.rows.map((row: { id: string }) => row.id)).toEqual(["prop-7", "prop-6", "prop-5", "prop-4", "prop-3"]);
    expect(most.total).toBe(8);
    const fewest = await (await properties(request("/api/admin/insights/properties?period=last-month&sort=cleans&dir=asc&page=1&pageSize=5"))).json();
    expect(fewest.rows.map((row: { id: string }) => row.id)).toEqual(["prop-0", "prop-1", "prop-2", "prop-3", "prop-4"]);
    expect((await properties(request("/api/admin/insights/properties?sort=ratio&dir=desc&pageSize=5"))).status).toBe(200);
  });
});
