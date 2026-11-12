// @vitest-environment node
// Wave E: Cases "Create repair quote" pre-fills the new quote on the server
// from the case (client, property address, title, description, the case's
// image evidence), links the created quote to the case without a schema change
// (a FROM_CASE quote event plus an internal case note, in the quote's own
// transaction), checks reference images (case evidence or the caller's / an
// office account's uploads) and sends nothing to the client.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Role } from "@prisma/client";

const m = vi.hoisted(() => ({
  role: vi.fn(), ticket: vi.fn(), caseAttachments: vi.fn(), quoteCreate: vi.fn(), quoteEvent: vi.fn(), caseComment: vi.fn(), leadCreate: vi.fn(),
  quoteEvents: vi.fn(), quoteEventFirst: vi.fn(), office: vi.fn(), email: vi.fn(), settings: vi.fn(),
}));
vi.mock("@/lib/auth/session", () => ({ requireRole: m.role }));
vi.mock("@/lib/settings", () => ({ getAppSettings: m.settings }));
vi.mock("@/lib/notifications/email", () => ({ sendEmailDetailed: m.email, sendEmail: m.email }));
vi.mock("@/lib/db", () => {
  const tx = { quote: { create: m.quoteCreate }, quoteEvent: { create: m.quoteEvent }, caseComment: { create: m.caseComment } };
  return { db: {
    issueTicket: { findUnique: m.ticket },
    caseAttachment: { findMany: m.caseAttachments },
    quote: { create: m.quoteCreate },
    quoteLead: { create: m.leadCreate },
    quoteEvent: { findMany: m.quoteEvents, findFirst: m.quoteEventFirst },
    user: { findMany: m.office },
    jobAssignment: { findMany: vi.fn().mockResolvedValue([]) },
    $transaction: (run: (client: typeof tx) => unknown) => run(tx),
  } };
});

import { POST } from "@/app/api/admin/quotes/route";
import { caseForQuoteDetail, loadCaseQuotePrefill, quoteReference, quotesFromCase } from "@/lib/cases/repair-quote";

const admin = { user: { id: "admin-1", role: Role.ADMIN } };
const caseRow = {
  id: "case-1", title: "Broken shower screen", description: "Guest reported the screen cracked.", caseType: "DAMAGE",
  client: null, property: null,
  job: { jobNumber: "J-1031", property: { id: "p1", name: "Bondi Studio", address: "1 Test St", suburb: "Bondi", client: { id: "cl1", name: "Harbour Stays" } } },
  attachments: [
    { s3Key: "cases/client-9/abc.jpg", url: "https://files.invalid/cases/client-9/abc.jpg", mimeType: "image/jpeg", label: "Crack" },
    { s3Key: "cases/client-9/doc.pdf", url: "https://files.invalid/cases/client-9/doc.pdf", mimeType: "application/pdf", label: "Invoice" },
  ],
};
const quoteBody = (overrides: Record<string, unknown> = {}) => ({
  clientId: "cl1", serviceType: "GENERAL_CLEAN", lineItems: [{ label: "Repair", unitPrice: 100, qty: 1, total: 100 }], subtotal: 100, gstAmount: 10, totalAmount: 110,
  referenceImages: [{ key: "cases/client-9/abc.jpg", url: "https://files.invalid/cases/client-9/abc.jpg", label: "Crack" }],
  fromCaseId: "case-1",
  ...overrides,
});
const post = (body: Record<string, unknown>) => POST(new Request("http://localhost/x", { method: "POST", body: JSON.stringify(body) }) as never);

beforeEach(() => {
  vi.resetAllMocks();
  m.role.mockResolvedValue(admin);
  m.settings.mockResolvedValue({ pricing: { rackHourlyRate: 0, cleanerHourlyCost: 0 } });
  m.ticket.mockImplementation(async (args: { select: Record<string, unknown> }) => ("attachments" in args.select ? caseRow : { id: "case-1", title: caseRow.title }));
  m.caseAttachments.mockResolvedValue(caseRow.attachments.map((a) => ({ s3Key: a.s3Key })));
  m.quoteCreate.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({ id: "quote-abc123", ...data }));
  m.office.mockResolvedValue([]);
});

describe("prefill", () => {
  it("fills client and address from the case's job property, a title, a description and image evidence only", async () => {
    const prefill = await loadCaseQuotePrefill("case-1");
    expect(prefill).toMatchObject({
      caseId: "case-1", client: { id: "cl1", name: "Harbour Stays" }, property: { address: "1 Test St", suburb: "Bondi" },
      title: "Repair: Broken shower screen", referenceImages: [{ key: "cases/client-9/abc.jpg", label: "Crack" }],
    });
    expect(prefill?.description).toContain("Reported on job J-1031.");
    expect(prefill?.referenceImages).toHaveLength(1);
  });
  it("returns null for a case that does not exist", async () => {
    m.ticket.mockResolvedValue(null);
    expect(await loadCaseQuotePrefill("nope")).toBeNull();
  });
});

describe("create from a case", () => {
  it("links the quote to the case in its own transaction and sends nothing", async () => {
    const response = await post(quoteBody());
    expect(response.status).toBe(201);
    expect(m.quoteCreate.mock.calls[0][0].data).not.toHaveProperty("fromCaseId");
    expect(m.quoteEvent.mock.calls[0][0].data).toMatchObject({ quoteId: "quote-abc123", type: "FROM_CASE", detail: { caseId: "case-1", caseTitle: "Broken shower screen" } });
    expect(m.caseComment.mock.calls[0][0].data).toMatchObject({ caseId: "case-1", isInternal: true, body: expect.stringContaining(quoteReference("quote-abc123")) });
    expect(m.email).not.toHaveBeenCalled();
  });

  it("refuses a case that no longer exists", async () => {
    m.ticket.mockResolvedValue(null);
    expect((await post(quoteBody())).status).toBe(404);
    expect(m.quoteCreate).not.toHaveBeenCalled();
  });

  it("refuses another person's upload that is not the case's evidence", async () => {
    const response = await post(quoteBody({ referenceImages: [{ key: "quote-references/someone-else/x.jpg", url: "https://files.invalid/x.jpg" }] }));
    expect(response.status).toBe(403);
    expect(m.quoteCreate).not.toHaveBeenCalled();
  });

  it("accepts the caller's own uploads without a case", async () => {
    const response = await post(quoteBody({ fromCaseId: undefined, referenceImages: [{ key: "quote-references/admin-1/x.jpg", url: "https://files.invalid/x.jpg" }] }));
    expect(response.status).toBe(201);
    expect(m.quoteEvent).not.toHaveBeenCalled();
  });
});

describe("reading the link back", () => {
  it("lists the case's quotes and finds a quote's case", async () => {
    m.quoteEvents.mockResolvedValue([{ quoteId: "quote-abc123", createdAt: new Date("2026-11-12T01:00:00Z") }]);
    expect(await quotesFromCase("case-1")).toEqual([{ quoteId: "quote-abc123", reference: "Q-ABC123", createdAt: "2026-11-12T01:00:00.000Z", href: "/v2/admin/quotes/quote-abc123" }]);
    expect(m.quoteEvents.mock.calls[0][0].where).toEqual({ type: "FROM_CASE", detail: { path: ["caseId"], equals: "case-1" } });
    m.quoteEventFirst.mockResolvedValue({ detail: { caseId: "case-1", caseTitle: "Broken shower screen" } });
    expect(await caseForQuoteDetail("quote-abc123")).toEqual({ caseId: "case-1", caseTitle: "Broken shower screen", href: "/v2/admin/cases?open=case-1" });
  });
});
