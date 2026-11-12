import { describe, expect, it } from "vitest";
import { allowedPeopleTabs, accountListTabFor, normalizePeopleTab, peopleRedirectTarget } from "@/lib/people/tabs";
import { buildClientDirectoryResponse, buildClientRow, clientDirectoryCsv, filterClientRows, sortClientRows, type ClientFacts } from "@/lib/people/clients/derive";
import { parseClientDirectoryFilters, parseClientDirectoryQuery } from "@/lib/people/clients/types";
import { buildEmailListResponse, buildEmailRow, type PersonEmailFacts } from "@/lib/people/account-emails/derive";
import { parseAccountEmailListFilters, parseAccountEmailListQuery } from "@/lib/people/account-emails/types";
import { readClientsView, clientsViewSearch, patchClientsView } from "@/components/v2/admin/people/clients/clients-view";
import { readInvitationsView, invitationsViewSearch } from "@/components/v2/admin/people/invitations/invitations-view";
import { normalizeAccountTab } from "@/lib/accounts/list/tabs";

const NOW = new Date("2026-11-12T00:00:00Z");

describe("People tabs and old links", () => {
  it("opens drawn tabs, chip views and old values", () => {
    expect(normalizePeopleTab("clients", "cleaners")).toBe("clients");
    expect(normalizePeopleTab("team", "clients")).toBe("office");
    expect(normalizePeopleTab("staff", "clients")).toBe("office");
    expect(normalizePeopleTab("vas", "clients")).toBe("assistants");
    expect(normalizePeopleTab("emails", "clients")).toBe("invitations");
    expect(normalizePeopleTab("attention", "clients")).toBe("attention");
    expect(normalizePeopleTab("nonsense", "clients")).toBe("clients");
    expect(normalizePeopleTab(undefined, "cleaners")).toBe("cleaners");
  });

  it("maps login views onto the Accounts list API tabs", () => {
    expect(accountListTabFor("logins")).toBe("clients");
    expect(accountListTabFor("cleaners")).toBe("cleaners");
    expect(accountListTabFor("clients")).toBeNull();
    expect(accountListTabFor("invitations")).toBeNull();
    // People writes ?tab=logins; the Accounts list reads it as client logins.
    expect(normalizeAccountTab("logins")).toBe("clients");
  });

  it("hides the Clients tab from a viewer without the clients pack", () => {
    expect(allowedPeopleTabs({ clients: false })).not.toContain("clients");
    expect(allowedPeopleTabs({ clients: true })).toContain("clients");
  });

  it("redirects old list URLs into the right tab keeping every query value", () => {
    expect(peopleRedirectTarget("clients", undefined)).toBe("/v2/admin/accounts?tab=clients");
    expect(peopleRedirectTarget("cleaners", { q: "maria", status: "active" })).toBe("/v2/admin/accounts?tab=cleaners&q=maria&status=active");
    expect(peopleRedirectTarget("office", { tab: "team", open: "u1", ids: ["a", "b"] })).toBe("/v2/admin/accounts?tab=office&open=u1&ids=a&ids=b");
  });
});

function facts(overrides: Partial<ClientFacts>): ClientFacts {
  return {
    id: "c1", name: "Harbour View", suburb: "Bondi", email: "a@x.example", phone: null, isActive: true, createdAt: NOW,
    properties: 2, logins: 1, loginsInvited: 0, assistants: 0, invoicesOpen: 0, owing: 0, overdue: 0, overdueCount: 0, paidThisMonth: 0, lastCleanDay: null,
    ...overrides,
  };
}
const MONEY = { money: true };

describe("People › Clients rules", () => {
  const rows = [
    buildClientRow(facts({ id: "a", name: "Alpha", owing: 640, overdue: 640, overdueCount: 1, invoicesOpen: 1, lastCleanDay: "2026-11-10" }), MONEY),
    buildClientRow(facts({ id: "b", name: "Bravo", logins: 0, assistants: 2 }), MONEY),
    buildClientRow(facts({ id: "c", name: "Charlie", isActive: false, owing: null, overdue: null, paidThisMonth: null }), MONEY),
  ];

  it("derives needs attention from overdue invoices and missing portal logins", () => {
    expect(rows[0].attention).toEqual(["OVERDUE"]);
    expect(rows[1].attention).toEqual(["NO_LOGIN"]);
    expect(rows[2].attention).toEqual([]);
  });

  it("filters by every drawn chip and by search", () => {
    const ids = (filter: Parameters<typeof filterClientRows>[1]["filter"], q = "") => filterClientRows(rows, { filter, q }).map((row) => row.id);
    expect(ids("active")).toEqual(["a", "b"]);
    expect(ids("inactive")).toEqual(["c"]);
    expect(ids("owing")).toEqual(["a"]);
    expect(ids("overdue")).toEqual(["a"]);
    expect(ids("no-login")).toEqual(["b"]);
    expect(ids("assistants")).toEqual(["b"]);
    expect(ids("all", "bondi")).toEqual(["a", "b", "c"]);
    expect(ids("all", "char")).toEqual(["c"]);
  });

  it("sorts with an unreadable figure last in both directions", () => {
    expect(sortClientRows(rows, "owing", "desc").map((row) => row.id)).toEqual(["a", "b", "c"]);
    expect(sortClientRows(rows, "owing", "asc").map((row) => row.id)).toEqual(["b", "a", "c"]);
    expect(sortClientRows(rows, "lastClean", "desc")[0].id).toBe("a");
  });

  it("pages server-side with real totals, chip counts and header figures (unknown is null, never 0)", () => {
    const query = parseClientDirectoryQuery(new URLSearchParams("pageSize=1&page=2"), MONEY);
    const response = buildClientDirectoryResponse(rows, parseClientDirectoryFilters(new URLSearchParams("filter=all")), query, MONEY, 5);
    expect(response.total).toBe(3);
    expect(response.rows.map((row) => row.id)).toEqual(["b"]);
    expect(response.counts).toMatchObject({ all: 3, active: 2, overdue: 1, "no-login": 1, attention: 2 });
    expect(response.figures.outstanding).toBeNull();
    const known = buildClientDirectoryResponse(rows.slice(0, 2), { filter: "all", q: "" }, query, MONEY, 5);
    expect(known.figures).toMatchObject({ totalClients: 2, activeProperties: 5, outstanding: 640, overdue: 640 });
  });

  it("never sends or sorts money a viewer may not see", () => {
    const hidden = buildClientRow(facts({ owing: 100 }), { money: false });
    expect(hidden).not.toHaveProperty("owing");
    expect(hidden).not.toHaveProperty("paidThisMonth");
    expect(() => parseClientDirectoryQuery(new URLSearchParams("sort=owing"), { money: false })).toThrow(/Cannot sort/);
    expect(clientDirectoryCsv([hidden], { money: false })).not.toMatch(/Owing/);
  });

  it("refuses an unknown filter and escapes formulas in the export", () => {
    expect(() => parseClientDirectoryFilters(new URLSearchParams("filter=everyone"))).toThrow(/Unknown filter/);
    const csv = clientDirectoryCsv([buildClientRow(facts({ name: "=HYPERLINK(1)" }), MONEY)], MONEY);
    expect(csv).toContain("'=HYPERLINK(1)");
  });

  it("keeps the view in the URL and starts again at page 1 when the list changes", () => {
    const view = readClientsView("?tab=clients&filter=overdue&sort=owing&dir=desc&page=3&open=c_1");
    expect(view).toMatchObject({ filter: "overdue", sort: "owing", dir: "desc", page: 3, open: "c_1" });
    expect(patchClientsView(view, { filter: "owing" }).page).toBe(1);
    expect(clientsViewSearch({ ...view, page: 1, open: null })).toBe("?tab=clients&filter=overdue&sort=owing&dir=desc");
    expect(readClientsView("?filter=bad&open=../x")).toMatchObject({ filter: "active", open: null });
  });
});

function person(overrides: Partial<PersonEmailFacts>): PersonEmailFacts {
  return {
    userId: "u1", name: "Lena", email: "lena@x.example", role: "CLEANER", roles: ["CLEANER"], isActive: true, emailVerified: false, lastSeenAt: null, context: null,
    invitation: { createdAt: new Date("2026-11-08T00:00:00Z"), acceptedAt: null, expiresAt: new Date("2026-11-15T00:00:00Z"), createdById: "admin", createdByName: "Hannah" },
    latest: null,
    ...overrides,
  };
}
const ADMIN = { id: "admin", heldRoles: ["ADMIN"] };
const OPS = { id: "ops", heldRoles: ["OPS_MANAGER"] };

describe("People › Invitations (account emails) rules", () => {
  it("offers Resend and Copy link on a pending, valid invitation, with delivery Not recorded when nothing was recorded", () => {
    const row = buildEmailRow(person({}), ADMIN, NOW);
    expect(row).toMatchObject({ kind: "INVITATION", nextStep: "RESEND_INVITATION", canResend: true, canCopyLink: true, delivery: "NOT_RECORDED", sentBy: "Hannah", needsAction: true, neverSignedIn: true });
  });

  it("calls a lapsed invitation New invite and never offers its dead link", () => {
    const row = buildEmailRow(person({ invitation: { createdAt: new Date("2026-10-29T00:00:00Z"), acceptedAt: null, expiresAt: new Date("2026-11-05T00:00:00Z"), createdById: null, createdByName: null } }), ADMIN, NOW);
    expect(row).toMatchObject({ nextStep: "NEW_INVITATION", expired: true, canCopyLink: false, canResend: true });
  });

  it("labels a client assistant's invitation as Assistant access", () => {
    expect(buildEmailRow(person({ role: "VA", roles: ["VA"] }), ADMIN, NOW).kind).toBe("ASSISTANT_ACCESS");
  });

  it("never lets an operations manager send upward, and passes on an impersonation or pack refusal", () => {
    const upward = buildEmailRow(person({ role: "ADMIN", roles: ["ADMIN"] }), OPS, NOW);
    expect(upward).toMatchObject({ canResend: false, canCopyLink: false });
    expect(upward.refusal).toMatch(/above yours/);
    const refused = buildEmailRow(person({}), { refused: "You are testing as someone else." }, NOW);
    expect(refused).toMatchObject({ canResend: false, canCopyLink: false, refusal: "You are testing as someone else." });
    expect(buildEmailRow(person({ userId: "admin" }), ADMIN, NOW).canResend).toBe(false);
  });

  it("shows the provider's recorded answer for the latest recorded email; accepted is not delivered", () => {
    const row = buildEmailRow(person({ invitation: null, emailVerified: true, lastSeenAt: NOW, latest: { kind: "PASSWORD_RESET", at: new Date("2026-11-11T00:00:00Z"), actorId: null, actorName: "The person", state: "ACCEPTED" } }), ADMIN, NOW);
    expect(row).toMatchObject({ kind: "PASSWORD_RESET", delivery: "ACCEPTED", nextStep: null, canResend: false, needsAction: false, neverSignedIn: false });
  });

  it("filters, counts and figures from real rows", () => {
    const rows = [
      buildEmailRow(person({}), ADMIN, NOW),
      buildEmailRow(person({ userId: "u2", invitation: null, emailVerified: true, lastSeenAt: NOW, latest: { kind: "TEMPORARY_PASSWORD", at: new Date("2026-11-10T00:00:00Z"), actorId: "admin", actorName: "Hannah", state: "NOT_ACCEPTED" } }), ADMIN, NOW),
    ];
    const filters = parseAccountEmailListFilters(new URLSearchParams("state=all"));
    const response = buildEmailListResponse(rows, filters, parseAccountEmailListQuery(new URLSearchParams()), { resets: { total: 1, byOffice: 1 }, viewerRefusal: null }, NOW);
    expect(response.total).toBe(2);
    expect(response.stateCounts).toMatchObject({ "needs-action": 2, "never-signed-in": 1, "not-sent": 1 });
    expect(response.kindCounts.TEMPORARY_PASSWORD).toBe(1);
    expect(response.figures).toMatchObject({ notAccepted: 1, expired: 0, passwordResets7d: 1 });
    expect(() => parseAccountEmailListFilters(new URLSearchParams("kind=SMS"))).toThrow(/Unknown email type/);
  });

  it("keeps the Invitations view in the URL", () => {
    const view = readInvitationsView("?tab=invitations&kind=INVITATION&state=expired&period=90d&open=u_1");
    expect(view).toMatchObject({ kind: "INVITATION", state: "expired", period: "90d", open: "u_1" });
    expect(invitationsViewSearch(view)).toBe("?tab=invitations&kind=INVITATION&state=expired&period=90d&open=u_1");
  });
});
