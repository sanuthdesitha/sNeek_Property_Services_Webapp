// @vitest-environment node
import { describe, expect, it } from "vitest";
import type { Role } from "@prisma/client";
import { ACCOUNT_TABS, normalizeAccountTab, roleFilterOptions } from "@/lib/accounts/list/tabs";
import {
  DOCUMENT_EXPIRY_WARNING_DAYS,
  INVITE_PENDING_ATTENTION_DAYS,
  accountStatus,
  attentionReasons,
  documentState,
  type AccountFacts,
} from "@/lib/accounts/list/attention";
import { buildListResponse, buildRow, filterRows, sortRows, tabCounts, type AccountRecord } from "@/lib/accounts/list/derive";
import { parseAccountFilters, parseAccountListQuery, type AccountRow } from "@/lib/accounts/list/types";
import { accountsCsv } from "@/lib/accounts/list/csv";
import { readAccountsView, viewSearch } from "@/components/v2/admin/accounts/hub/accounts-view";

const NOW = new Date("2026-11-11T02:00:00Z"); // 1pm Sydney
const days = (n: number) => new Date(NOW.getTime() + n * 24 * 60 * 60 * 1000);

function record(overrides: Partial<AccountRecord> = {}): AccountRecord {
  return {
    id: "u1",
    name: "Aiko Tanaka",
    email: "aiko@example.com",
    phone: "0400 000 001",
    role: "CLEANER",
    isActive: true,
    emailVerified: days(-100),
    invitation: null,
    documents: [],
    missingDocuments: [],
    credentials: {},
    upcomingAssignments: 0,
    extraRoles: [],
    twoFactorEnabled: false,
    clientName: null,
    hourlyRate: 34,
    lastSeenAt: null,
    ...overrides,
  };
}
const ALL = { pay: true, quality: true };

describe("account tabs", () => {
  it("maps every old ?tab= value onto a new tab", () => {
    expect(normalizeAccountTab("team")).toBe("office");
    expect(normalizeAccountTab("staff")).toBe("office");
    expect(normalizeAccountTab("cleaners")).toBe("cleaners");
    expect(normalizeAccountTab("clients")).toBe("clients");
    expect(normalizeAccountTab("assistants")).toBe("assistants");
    expect(normalizeAccountTab("vas")).toBe("assistants");
    expect(normalizeAccountTab("partners")).toBe("partners");
    expect(normalizeAccountTab(undefined)).toBe("everyone");
    expect(normalizeAccountTab("nonsense")).toBe("everyone");
    for (const tab of ACCOUNT_TABS) expect(normalizeAccountTab(tab)).toBe(tab);
  });

  it("reads old links through the hub's URL state too", () => {
    expect(readAccountsView("?tab=team").tab).toBe("office");
    expect(readAccountsView("?tab=team&open=abc_1").open).toBe("abc_1");
    expect(readAccountsView("?open=../../x").open).toBeNull();
    expect(viewSearch({ ...readAccountsView(""), tab: "cleaners", page: 2 })).toBe("?tab=cleaners&page=2");
  });

  it("offers a role filter only where a tab spans roles", () => {
    expect(roleFilterOptions("cleaners")).toEqual([]);
    expect(roleFilterOptions("office")).toEqual(["ADMIN", "OPS_MANAGER", "QA_INSPECTOR", "MAINTENANCE"]);
    expect(roleFilterOptions("partners")).toEqual([]);
    expect(() => parseAccountFilters(new URLSearchParams("tab=cleaners&role=ADMIN"))).toThrow(/cannot be filtered/);
  });
});

describe("needs attention rules", () => {
  const facts = (overrides: Partial<AccountFacts>) => record(overrides);

  it("flags an invite only after the named number of days", () => {
    const within = facts({ emailVerified: null, invitation: { createdAt: days(-INVITE_PENDING_ATTENTION_DAYS), acceptedAt: null } });
    const beyond = facts({ emailVerified: null, invitation: { createdAt: days(-(INVITE_PENDING_ATTENTION_DAYS + 1)), acceptedAt: null } });
    expect(accountStatus(within)).toBe("INVITED");
    expect(attentionReasons(within, NOW)).toEqual([]);
    expect(attentionReasons(beyond, NOW)).toEqual(["INVITE_PENDING"]);
  });

  it("names missing, expired and expiring documents, most urgent first", () => {
    expect(documentState(facts({ missingDocuments: ["Police check", "White card"] }), NOW)).toMatchObject({ kind: "MISSING", label: "2 missing" });
    expect(documentState(facts({ documents: [{ title: "Police check", status: "VERIFIED", expiresAt: days(-1) }] }), NOW)).toMatchObject({ kind: "EXPIRED" });
    expect(documentState(facts({ documents: [{ title: "Police check", status: "VERIFIED", expiresAt: days(9) }] }), NOW)).toMatchObject({ kind: "EXPIRING", label: "Police check, 9 d" });
    expect(documentState(facts({ documents: [{ title: "Police check", status: "VERIFIED", expiresAt: days(DOCUMENT_EXPIRY_WARNING_DAYS + 5) }] }), NOW)).toMatchObject({ kind: "OK" });
    expect(documentState(facts({ credentials: { visaExpiry: days(30) } }), NOW)).toMatchObject({ kind: "EXPIRING" });
    expect(documentState(facts({}), NOW)).toMatchObject({ kind: "NONE", label: "None on file" });
    // A rejected file is not "on file".
    expect(documentState(facts({ documents: [{ title: "x", status: "REJECTED", expiresAt: days(-3) }] }), NOW).kind).toBe("NONE");
  });

  it("flags a disabled account still assigned to upcoming jobs, and an unverified active email", () => {
    expect(attentionReasons(facts({ isActive: false, upcomingAssignments: 2 }), NOW)).toEqual(["DISABLED_ASSIGNED"]);
    expect(attentionReasons(facts({ isActive: false, upcomingAssignments: 0 }), NOW)).toEqual([]);
    expect(attentionReasons(facts({ emailVerified: null }), NOW)).toEqual(["EMAIL_UNVERIFIED"]);
  });
});

describe("list derivation", () => {
  const records: AccountRecord[] = [
    record({ id: "a", name: "Aiko", role: "CLEANER", hourlyRate: 34 }),
    record({ id: "b", name: "Bea", role: "CLEANER", hourlyRate: null, isActive: false, upcomingAssignments: 1 }),
    record({ id: "c", name: "Cal", role: "ADMIN", hourlyRate: null }),
    record({ id: "d", name: "Dee", role: "CLIENT", clientName: "Harbour Co", hourlyRate: null }),
    record({ id: "e", name: "Eve", role: "VA", hourlyRate: null }),
    record({ id: "f", name: "Fin", role: "LAUNDRY", hourlyRate: 30, missingDocuments: ["ABN"] }),
  ];
  const figures = new Map([["a", { jobs30: 18, qa30: 88 }]]);
  const rows = records.map((r) => buildRow(r, figures, ALL, NOW));

  it("counts every tab from real rows, including Needs attention", () => {
    expect(tabCounts(rows)).toEqual({ everyone: 6, cleaners: 2, office: 1, clients: 1, assistants: 1, partners: 1, attention: 2 });
  });

  it("shows a missing figure as null, never 0, and 0 only for a cleaner with no cleans", () => {
    const byId = new Map(rows.map((r) => [r.id, r]));
    expect(byId.get("a")).toMatchObject({ jobs30: 18, qa30: 88 });
    expect(byId.get("b")).toMatchObject({ jobs30: 0, qa30: null });
    expect(byId.get("c")).toMatchObject({ jobs30: null, qa30: null });
  });

  it("omits columns the viewer may not see", () => {
    const row = buildRow(records[0], figures, { pay: false, quality: false }, NOW);
    expect("rate" in row).toBe(false);
    expect("jobs30" in row).toBe(false);
    expect("qa30" in row).toBe(false);
  });

  it("filters by tab, status, documents and search (name, email, phone digits)", () => {
    const base = parseAccountFilters(new URLSearchParams(""));
    expect(filterRows(rows, { ...base, tab: "cleaners", status: "disabled" }).map((r) => r.id)).toEqual(["b"]);
    expect(filterRows(rows, { ...base, documents: true }).map((r) => r.id)).toEqual(["f"]);
    expect(filterRows(rows, { ...base, q: "dee" }).map((r) => r.id)).toEqual(["d"]);
    expect(filterRows(rows, { ...base, q: "0400000001" }).length).toBe(6);
  });

  it("sorts with missing values last in both directions", () => {
    expect(sortRows(rows, "rate", "desc").map((r) => r.id).slice(0, 2)).toEqual(["a", "f"]);
    expect(sortRows(rows, "rate", "asc").map((r) => r.id).slice(0, 2)).toEqual(["f", "a"]);
    expect(sortRows(rows, "rate", "asc").at(-1)?.rate).toBeNull();
  });

  it("refuses sorting by an unknown or hidden column", () => {
    expect(() => parseAccountListQuery(new URLSearchParams("sort=password"), ALL)).toThrow(/Cannot sort/);
    expect(() => parseAccountListQuery(new URLSearchParams("sort=rate"), { pay: false, quality: true })).toThrow(/Cannot sort/);
    expect(() => parseAccountListQuery(new URLSearchParams("sort=qa30"), { pay: true, quality: false })).toThrow(/Cannot sort/);
    expect(parseAccountListQuery(new URLSearchParams("sort=rate&dir=desc"), ALL)).toMatchObject({ sort: "rate", dir: "desc" });
  });

  it("pages the filtered set and reports the real total", () => {
    const filters = parseAccountFilters(new URLSearchParams(""));
    const query = parseAccountListQuery(new URLSearchParams("pageSize=2&page=2"), ALL);
    const response = buildListResponse(rows, filters, query, ALL);
    expect(response).toMatchObject({ total: 6, page: 2, pageSize: 2, pageCount: 3 });
    expect(response.rows.map((r) => r.id)).toEqual(["c", "d"]);
    expect(response.summary).toMatchObject({ people: 6, invitesPending: 0 });
  });
});

describe("export", () => {
  const row: AccountRow = {
    id: "x", name: "=HYPERLINK(evil)", email: "x@example.com", phone: null, role: "CLEANER" as Role, extraRoles: ["QA_INSPECTOR"],
    status: "ACTIVE", inviteAgeDays: null, emailVerified: true, twoFactorEnabled: false, clientName: null,
    rate: 36.5, jobs30: null, qa30: 94, documents: { kind: "OK", label: "Up to date" }, lastSeenAt: null, attention: [],
  };

  it("writes the columns on screen, escapes formulas, and writes a missing figure empty", () => {
    const csv = accountsCsv([row], { pay: true, quality: true });
    const [header, line] = csv.trim().split("\r\n");
    expect(header).toContain("Hourly rate (AUD)");
    expect(line.startsWith("'=HYPERLINK(evil)")).toBe(true);
    expect(line).toContain("36.5,,94");
  });

  it("omits the rate and quality figures for a viewer who may not see them, and never writes bank details", () => {
    const csv = accountsCsv([row], { pay: false, quality: false });
    expect(csv).not.toContain("Hourly rate");
    expect(csv).not.toContain("36.5");
    expect(csv).not.toContain("Jobs, 30 d");
    expect(csv.toLowerCase()).not.toMatch(/bsb|account number|abn|password/);
  });
});
