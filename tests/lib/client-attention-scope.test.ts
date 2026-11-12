// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "@/app/api/client/attention-counts/route";

const mocks = vi.hoisted(() => ({
  portal: vi.fn(), approvals: vi.fn(), cases: vi.fn(), quotes: vi.fn(),
  invoices: vi.fn(), client: vi.fn(), messages: vi.fn(), jobs: vi.fn(),
}));
vi.mock("@/lib/auth/client-portal", () => ({ requireClientPortal: mocks.portal }));
vi.mock("@/lib/commercial/client-approval-access", () => ({ countPendingApprovalsForUser: mocks.approvals }));
vi.mock("@/lib/db", () => ({ db: {
  issueTicket: { count: mocks.cases },
  quote: { count: mocks.quotes }, clientInvoice: { count: mocks.invoices },
  client: { findUnique: mocks.client },
  clientMessage: { count: mocks.messages }, job: { findMany: mocks.jobs },
} }));

// Merged per-client visibility, as requireClientPortal returns it.
const VISIBILITY = {
  showProperties: true, showJobs: true, showBooking: true, showCalendar: false, showReports: true,
  showInventory: true, showShopping: false, showStockRuns: true, allowStockRuns: true,
  showFinanceDetails: false, showCases: true, showLaundryUpdates: true, showQuoteRequests: true,
  showApprovals: true, showClientTaskRequests: false,
};
const MODULES = {
  jobs: true, calendar: false, reports: true, laundry: true, properties: true, inventory: true,
  shopping: false, stockRuns: true, cases: true, finance: false, quoteRequests: true, approvals: true,
  booking: true, taskRequests: false,
};

function portal(actor = "VA", propertyIds: string[] | null = ["allowed"], permissions = {}) {
  return { actor, userId: "portal-user", clientId: "client", propertyIds, permissions,
    team: actor === "VA" ? { name: "Assistants" } : null, visibility: VISIBILITY };
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.portal.mockResolvedValue(portal());
  mocks.approvals.mockResolvedValue(2);
  mocks.cases.mockResolvedValue(3);
  mocks.quotes.mockResolvedValue(4);
  mocks.invoices.mockResolvedValue(5);
  mocks.client.mockResolvedValue({ name: "Owner" });
  mocks.messages.mockResolvedValue(6);
  mocks.jobs.mockResolvedValue([{ id: "job-allowed" }]);
});

describe("client attention scope", () => {
  it("preserves client counts and waiting-state filters", async () => {
    mocks.portal.mockResolvedValue(portal("CLIENT", null));
    const response = await GET();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      portal: { actor: "CLIENT", permissions: {}, actingFor: null, teamName: null, modules: MODULES },
      counts: { "/v2/client/approvals": 2, "/v2/client/cases": 3,
        "/v2/client/quotes": 4, "/v2/client/finance": 5, "/v2/client/messages": 6 },
    });
    // Unread office replies across the whole client thread (no property scope).
    expect(mocks.messages).toHaveBeenCalledWith({ where: { clientId: "client", isFromAdmin: true, isRead: false } });
    expect(mocks.jobs).not.toHaveBeenCalled();
    // The badge counts what the Approvals page lists for this person, not the
    // client's own job requests waiting on the office.
    expect(mocks.approvals).toHaveBeenCalledWith("portal-user");
    expect(mocks.cases).toHaveBeenCalledWith({ where: {
      clientId: "client", state: "AWAITING_CLIENT", clientVisible: true,
    } });
    expect(mocks.quotes).toHaveBeenCalledWith({ where: { clientId: "client", status: "SENT" } });
    expect(mocks.invoices).toHaveBeenCalledWith({ where: {
      clientId: "client", kind: "INVOICE", status: { in: ["SENT", "APPROVED", "PART_PAID"] },
    } });
    expect(mocks.client).not.toHaveBeenCalled();
  });

  it("does not query or disclose any denied VA counts", async () => {
    const response = await GET();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      portal: { actor: "VA", permissions: {}, actingFor: "Owner", teamName: "Assistants", modules: MODULES },
      counts: {},
    });
    for (const query of [mocks.approvals, mocks.cases, mocks.quotes, mocks.invoices, mocks.messages]) {
      expect(query).not.toHaveBeenCalled();
    }
  });

  it.each([null, ["allowed"], []])("scopes permitted VA cases and invoices for %j", async (propertyIds) => {
    mocks.portal.mockResolvedValue(portal("VA", propertyIds, { maintenance: true, invoicesView: true }));
    const response = await GET();
    expect((await response.json()).counts).toEqual({ "/v2/client/cases": 3, "/v2/client/finance": 5 });
    expect(mocks.approvals).not.toHaveBeenCalled();
    expect(mocks.quotes).not.toHaveBeenCalled();
    const property = { clientId: "client", id: { in: propertyIds } };
    expect(mocks.cases).toHaveBeenCalledWith({ where: {
      clientId: "client", state: "AWAITING_CLIENT", clientVisible: true,
      ...(propertyIds ? { property } : {}),
    } });
    expect(mocks.invoices).toHaveBeenCalledWith({ where: {
      clientId: "client", kind: "INVOICE", status: { in: ["SENT", "APPROVED", "PART_PAID"] },
      ...(propertyIds ? { lines: { some: {}, every: { job: { property } } } } : {}),
    } });
  });

  it.each([
    [{ maintenance: true }, { "/v2/client/cases": 3 }, "invoices"],
    [{ invoicesView: true }, { "/v2/client/finance": 5 }, "cases"],
  ] as const)("grants each VA count independently: %j", async (permissions, counts, denied) => {
    mocks.portal.mockResolvedValue(portal("VA", ["allowed"], permissions));
    expect((await (await GET()).json()).counts).toEqual(counts);
    expect(mocks[denied]).not.toHaveBeenCalled();
  });

  it("uses the finance service's nonempty, every-job scope for mixed invoices", async () => {
    mocks.portal.mockResolvedValue(portal("VA", ["allowed"], { invoicesView: true }));
    // A scoped invoice must exclude mixed properties, foreign owners, manual
    // lines (even property-tagged ones), and the vacuous empty-invoice match.
    const allowed = { job: { property: { id: "allowed", clientId: "client" } } };
    const fixtures = [
      [allowed, allowed],
      [allowed, { job: { property: { id: "hidden", clientId: "client" } } }],
      [{ job: { property: { id: "allowed", clientId: "other-client" } } }],
      [allowed, { job: null, propertyId: "allowed" }],
      [],
    ];
    mocks.invoices.mockImplementation(async ({ where }) => {
      expect(where.lines.some).toEqual({});
      const scope = where.lines.every.job.property;
      return fixtures.filter((lines) => lines.length > 0 && lines.every((line) =>
        line.job && line.job.property.clientId === scope.clientId &&
        scope.id.in.includes(line.job.property.id)
      )).length;
    });
    expect((await (await GET()).json()).counts).toEqual({ "/v2/client/finance": 1 });
  });

  it("counts unread messages only inside a messages-granted VA's job scope", async () => {
    mocks.portal.mockResolvedValue(portal("VA", ["allowed"], { messages: true }));
    expect((await (await GET()).json()).counts).toEqual({ "/v2/client/messages": 6 });
    expect(mocks.jobs).toHaveBeenCalledWith({
      where: { property: { clientId: "client", id: { in: ["allowed"] } } }, select: { id: true },
    });
    expect(mocks.messages).toHaveBeenCalledWith({ where: {
      clientId: "client", isFromAdmin: true, isRead: false,
      OR: [{ jobId: null }, { jobId: { in: ["job-allowed"] } }],
    } });
  });

  it("reports module switches from the merged per-client visibility", async () => {
    mocks.portal.mockResolvedValue({ ...portal("CLIENT", null), visibility: { ...VISIBILITY, showFinanceDetails: true, showCases: false } });
    const { portal: gate } = await (await GET()).json();
    expect(gate.modules).toEqual({ ...MODULES, finance: true, cases: false });
  });

  it.each(["approvals", "cases", "quotes", "invoices", "client", "portal", "messages"] as const)(
    "returns retriable failure without counts or grants when %s fails", async (query) => {
      mocks.portal.mockResolvedValue(portal(query === "client" ? "VA" : "CLIENT", null));
      mocks[query].mockRejectedValue(new Error("database connection lost: private details"));
      const response = await GET();
      expect(response.status).toBe(503);
      expect(await response.json()).toEqual({ error: "Could not load counts." });
    }
  );

  it.each([["UNAUTHORIZED", 401], ["FORBIDDEN", 403]] as const)(
    "preserves %s status", async (message, status) => {
      mocks.portal.mockRejectedValue(new Error(message));
      const response = await GET();
      expect(response.status).toBe(status);
      expect(await response.json()).toEqual({ error: message });
      expect(mocks.cases).not.toHaveBeenCalled();
    }
  );
});
