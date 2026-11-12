// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const m = vi.hoisted(() => ({
  requireRole: vi.fn(),
  resolveViewer: vi.fn(),
  redirect: vi.fn((url: string) => {
    throw new Error(`REDIRECT:${url}`);
  }),
  loadClientDirectory: vi.fn(),
  verify: vi.fn(),
  sendLifecycle: vi.fn(),
  clientFind: vi.fn(),
  clientUpdate: vi.fn(),
  auditCreate: vi.fn(),
  listAccountEmails: vi.fn(),
}));
vi.mock("next/navigation", () => ({ redirect: m.redirect, notFound: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({ requireRole: m.requireRole }));
vi.mock("@/lib/accounts/viewer", () => ({ resolveAccountsViewer: m.resolveViewer }));
vi.mock("@/lib/people/clients/service", () => ({ loadClientDirectory: m.loadClientDirectory }));
vi.mock("@/lib/security/admin-verification", () => ({ verifySensitiveAction: m.verify }));
vi.mock("@/lib/notifications/lifecycle", () => ({ sendLifecycleEmail: m.sendLifecycle }));
vi.mock("@/lib/people/account-emails/service", () => ({ listAccountEmails: m.listAccountEmails }));
vi.mock("@/lib/db", () => ({ db: { client: { findUnique: m.clientFind, update: m.clientUpdate, findMany: vi.fn(async () => []) }, auditLog: { create: m.auditCreate }, clientInvoice: { groupBy: vi.fn(async () => []) } } }));

import UsersPage from "@/app/v2/admin/users/page";
import ClientsPage from "@/app/v2/admin/clients/page";
import { GET as DIRECTORY } from "@/app/api/admin/clients/directory/route";
import { POST as BULK } from "@/app/api/admin/clients/bulk/route";
import { GET as EMAILS } from "@/app/api/admin/users/account-emails/route";
import { buildClientRow } from "@/lib/people/clients/derive";

const ADMIN = { user: { id: "admin", role: "ADMIN", heldRoles: ["ADMIN"] } };

function clientRow(id: string, owing: number) {
  return buildClientRow({ id, name: id, suburb: null, email: null, phone: null, isActive: true, createdAt: new Date(), properties: 1, logins: 1, loginsInvited: 0, assistants: 0, invoicesOpen: 1, owing, overdue: 0, overdueCount: 0, paidThisMonth: 0, lastCleanDay: null }, { money: true });
}

beforeEach(() => {
  vi.clearAllMocks();
  m.requireRole.mockResolvedValue(ADMIN);
  m.resolveViewer.mockResolvedValue({ canOpenPeople: true });
  m.loadClientDirectory.mockResolvedValue({ rows: [clientRow("a", 10), clientRow("b", 30)], activeProperties: 2 });
});

describe("old list URLs", () => {
  it("/v2/admin/users lands on People keeping the query string and the old tab's meaning", () => {
    expect(() => UsersPage({ searchParams: { tab: "team", q: "jo" } })).toThrow("REDIRECT:/v2/admin/accounts?tab=office&q=jo");
    expect(() => UsersPage({ searchParams: {} })).toThrow("REDIRECT:/v2/admin/accounts?tab=everyone");
  });

  it("/v2/admin/clients redirects into the Clients tab with its query string", async () => {
    await expect(ClientsPage({ searchParams: { q: "harbour" } })).rejects.toThrow("REDIRECT:/v2/admin/accounts?tab=clients&q=harbour");
  });

  it("keeps the old list for a manager who cannot open People yet (no lockout)", async () => {
    m.resolveViewer.mockResolvedValue({ canOpenPeople: false });
    await expect(ClientsPage({ searchParams: {} })).resolves.toBeTruthy();
    expect(m.redirect).not.toHaveBeenCalled();
  });
});

describe("GET /api/admin/clients/directory", () => {
  it("answers a server-sorted page with real totals", async () => {
    const res = await DIRECTORY(new NextRequest("http://x/api/admin/clients/directory?filter=all&sort=owing&dir=desc&pageSize=1"));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.total).toBe(2);
    expect(body.rows.map((row: { id: string }) => row.id)).toEqual(["b"]);
    expect(body.figures.outstanding).toBe(40);
  });

  it("refuses a malformed query with 400 and an unauthorised caller with 403", async () => {
    expect((await DIRECTORY(new NextRequest("http://x/api/admin/clients/directory?sort=margin"))).status).toBe(400);
    m.requireRole.mockRejectedValueOnce(new Error("FORBIDDEN"));
    expect((await DIRECTORY(new NextRequest("http://x/api/admin/clients/directory"))).status).toBe(403);
  });

  it("exports only the selected clients when ids are given", async () => {
    const res = await DIRECTORY(new NextRequest("http://x/api/admin/clients/directory?format=csv&ids=a"));
    const text = await res.text();
    expect(res.headers.get("Content-Type")).toContain("text/csv");
    expect(text.trim().split("\r\n")).toHaveLength(2);
  });
});

function bulk(body: unknown) {
  return BULK(new NextRequest("http://x/api/admin/clients/bulk", { method: "POST", body: JSON.stringify(body) }));
}

describe("POST /api/admin/clients/bulk", () => {
  it("marks inactive only behind the PIN and the clients.delete grant, one outcome per client", async () => {
    m.clientFind.mockResolvedValueOnce({ isActive: true }).mockResolvedValueOnce({ isActive: false });
    const res = await bulk({ action: "mark-inactive", ids: ["a", "b"], security: { pin: "1234" } });
    const body = await res.json();
    expect(m.verify).toHaveBeenCalledWith("admin", { pin: "1234" }, "clients.delete");
    expect(body.results).toEqual([
      { id: "a", outcome: "done", message: "Marked inactive." },
      { id: "b", outcome: "unchanged", message: "Already inactive." },
    ]);
    expect(m.auditCreate).toHaveBeenCalledTimes(1);
  });

  it("refuses without a PIN and reports a wrong PIN as 403, changing nothing", async () => {
    expect((await bulk({ action: "mark-inactive", ids: ["a"] })).status).toBe(400);
    m.verify.mockRejectedValueOnce(new Error("INVALID_SECURITY_VERIFICATION"));
    expect((await bulk({ action: "mark-inactive", ids: ["a"], security: { pin: "0" } })).status).toBe(403);
    expect(m.clientUpdate).not.toHaveBeenCalled();
  });

  it("sends an update through the client lifecycle email and never reports a skipped client as done", async () => {
    m.sendLifecycle.mockResolvedValueOnce({ sent: true, recipients: ["a@x"] }).mockResolvedValueOnce({ sent: false, recipients: [], skipped: "no-recipients" });
    const body = await (await bulk({ action: "send-update", ids: ["a", "b"], subject: "Hello", message: "Line <b>one</b>" })).json();
    expect(m.sendLifecycle).toHaveBeenCalledWith(expect.objectContaining({ clientId: "a", stage: "CUSTOM", mode: "manual", extra: { subject: "Hello", bodyHtml: "<p>Line &lt;b&gt;one&lt;/b&gt;</p>" } }));
    expect(body.results.map((row: { outcome: string }) => row.outcome)).toEqual(["done", "refused"]);
  });
});

describe("GET /api/admin/users/account-emails", () => {
  it("passes the live session to the list (rights are decided per row on the server)", async () => {
    m.listAccountEmails.mockResolvedValue({ rows: [], total: 0 });
    const res = await EMAILS(new NextRequest("http://x/api/admin/users/account-emails?state=expired"));
    expect(res.status).toBe(200);
    expect(m.listAccountEmails).toHaveBeenCalledWith(ADMIN, expect.objectContaining({ state: "expired" }), expect.objectContaining({ sort: "sent" }));
  });

  it("refuses an unknown filter with 400", async () => {
    expect((await EMAILS(new NextRequest("http://x/api/admin/users/account-emails?state=bounced"))).status).toBe(400);
  });
});
