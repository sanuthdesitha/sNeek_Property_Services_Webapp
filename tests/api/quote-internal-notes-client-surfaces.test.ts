// @vitest-environment node
/**
 * Office notes on a quote (Quote.internalNotes) never reach the client
 * (owner decision 2026-11-13). The stored row below carries a distinctive
 * secret; every client-facing surface is read from it and checked:
 *
 *   public quote page payload (route and server page props), the quote PDF and
 *   email body (buildQuoteHtml with and without the "view online" button), the
 *   send route's preview and real send (body, PDF attachments, subject), the
 *   client documents mailer, the client portal My quotes route, Approvals /
 *   dashboard (listQuotesWaiting), and message template variables.
 *
 * The database mock honours `select`, so a surface that asked for the column
 * would be caught; one that reads the whole row is caught by the output check.
 */
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const SECRET = "OFFICE-ONLY-7f3a: client haggles, floor is $410";

const ROW = {
  id: "quote-1",
  quoteNumber: 204,
  leadId: null,
  clientId: "c1",
  serviceType: "DEEP_CLEAN",
  lineItems: [{ label: "Deep clean", unitPrice: 480, qty: 1, total: 480 }],
  subtotal: 480,
  gstAmount: 48,
  totalAmount: 528,
  notes: 'Deep clean for your property.\n[[META:{"extras":[]}]]',
  internalNotes: SECRET,
  validUntil: new Date("2030-01-01T12:59:59.000Z"),
  status: "SENT",
  convertedJobId: null,
  viewedAt: null,
  acceptedAt: null,
  declinedAt: null,
  publicToken: "tok_abc",
  showAddOnPrices: false,
  referenceImages: null,
  serviceContext: null,
  frequency: "one_off",
  serviceAddress: "8 Arden St",
  serviceSuburb: "Coogee",
  requestedAddOns: null,
  discountCode: null,
  createdAt: new Date("2026-11-01T00:00:00.000Z"),
  updatedAt: new Date("2026-11-02T00:00:00.000Z"),
  client: { id: "c1", name: "Harbour View Stays", email: "accounts@harbourview.com.au", address: "8 Arden St", suburb: "Coogee" },
  lead: null,
};

type Select = Record<string, unknown> | undefined;

/** Returns only the selected keys, like Prisma does (scalars only; enough here). */
function project(row: Record<string, unknown>, select: Select): Record<string, unknown> {
  if (!select) return { ...row };
  return Object.fromEntries(Object.keys(select).filter((key) => select[key]).map((key) => [key, row[key]]));
}

const m = vi.hoisted(() => ({
  db: {
    quote: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
      update: vi.fn(async () => ({})),
      updateMany: vi.fn(async () => ({ count: 0 })),
      count: vi.fn(async () => 1),
    },
    notification: { create: vi.fn(async () => ({})) },
    client: { findUnique: vi.fn(async () => ({ id: "c1", name: "Harbour View Stays", email: "accounts@harbourview.com.au" })) },
  },
  requireRole: vi.fn(),
  rendered: [] as string[],
  sent: [] as Array<Record<string, unknown>>,
}));

vi.mock("@/lib/db", () => ({ db: m.db }));
vi.mock("@/lib/auth/session", () => ({ requireRole: m.requireRole }));
vi.mock("@/lib/settings", () => ({
  getAppSettings: vi.fn(async () => ({ companyName: "sNeek", logoUrl: "", reportLogoUrl: "", quoteDefaultEmailSubject: "Your quote", accountsEmail: "accounts@sneek.test", invoicing: {}, pricing: { gstEnabled: true } })),
}));
vi.mock("@/lib/checklists/store", () => ({ getChecklist: vi.fn(async () => null) }));
vi.mock("@/lib/quotes/events", () => ({ recordQuoteEvent: vi.fn(async () => undefined) }));
vi.mock("@/lib/app-url", () => ({ resolveAppUrl: (path: string) => `https://app.test${path}` }));
vi.mock("@/lib/commercial/delivery-profiles", () => ({ resolveClientDeliveryRecipients: vi.fn(async () => ["accounts@harbourview.com.au"]) }));
vi.mock("@/lib/s3", () => ({ publicUrl: (key: string) => `https://cdn.test/${key}` }));
vi.mock("@/lib/client/portal", () => ({ getClientPortalContext: vi.fn(async () => ({ clientId: "c1" })) }));
vi.mock("@/lib/reports/pdf", () => ({
  renderPdfFromHtml: vi.fn(async (html: string) => {
    m.rendered.push(html);
    return Buffer.from(html, "utf8");
  }),
  getJobReportPdfBuffer: vi.fn(async () => null),
}));
vi.mock("@/lib/notifications/wording/render", () => ({
  loadNotificationWording: vi.fn(async () => ({ line: () => "Your quote from sNeek", render: () => ({ subject: "Your quote", html: "<p>Your quote</p>" }) })),
}));
vi.mock("@/lib/billing/client-invoices", () => ({ getClientInvoice: vi.fn(), renderClientInvoicePdf: vi.fn() }));
vi.mock("@/lib/reports/access", () => ({ getStoredJobReport: vi.fn() }));
vi.mock("@/lib/jobs/job-number", () => ({ getJobReference: vi.fn() }));
vi.mock("@/lib/email-templates", () => ({ renderEmailTemplate: vi.fn() }));
vi.mock("@/lib/notifications/email", () => ({
  sendEmailDetailed: vi.fn(async (input: Record<string, unknown>) => {
    m.sent.push(input);
    return { ok: true };
  }),
}));

import { GET as publicQuoteGet } from "@/app/api/public/quote-view/[token]/route";
import PublicQuotePage from "@/app/q/[token]/page";
import { POST as sendQuote } from "@/app/api/admin/quotes/[id]/send/route";
import { GET as clientQuotesGet } from "@/app/api/client/quotes/route";
import { buildQuoteHtml } from "@/lib/pricing/quote-report";
import { listQuotesWaiting } from "@/lib/client/quotes-waiting";
import { resolveTemplate } from "@/lib/messages/variables";
import { previewDocument } from "@/lib/notifications/documents";

function expectNoSecret(value: unknown) {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  expect(text).not.toContain("OFFICE-ONLY-7f3a");
  expect(text).not.toContain("floor is $410");
  expect(text).not.toContain("internalNotes");
}

beforeEach(() => {
  vi.clearAllMocks();
  m.rendered = [];
  m.sent = [];
  m.requireRole.mockResolvedValue({ user: { id: "admin-1", role: "ADMIN" } });
  m.db.quote.findUnique.mockImplementation(async (args: { select?: Select }) => project(ROW, args?.select));
  m.db.quote.findMany.mockImplementation(async (args: { select?: Select }) => [project(ROW, args?.select)]);
});

describe("office notes are absent from every client-facing quote surface", () => {
  it("public quote page: the API payload", async () => {
    const res = await publicQuoteGet(new NextRequest("http://localhost/api/public/quote-view/tok_abc"), { params: { token: "tok_abc" } });
    expect(res.status).toBe(200);
    const payload = await res.json();
    expect(payload.notes).toBe("Deep clean for your property.");
    expectNoSecret(payload);
  });

  it("public quote page: the props the server page hands to the browser", async () => {
    const element = (await PublicQuotePage({ params: { token: "tok_abc" } })) as { props: Record<string, unknown> };
    expect(element.props.quote).toBeTruthy();
    expectNoSecret(element.props);
  });

  it("quote PDF and email body (buildQuoteHtml, both variants)", () => {
    const pdfHtml = buildQuoteHtml(ROW, { companyName: "sNeek" });
    const emailHtml = buildQuoteHtml(ROW, { companyName: "sNeek", viewOnlineUrl: "https://app.test/q/tok_abc" });
    expect(pdfHtml).toContain("Deep clean");
    expectNoSecret(pdfHtml);
    expectNoSecret(emailHtml);
  });

  it("send route preview: email body, subject and every rendered PDF", async () => {
    const req = new NextRequest("http://localhost/api/admin/quotes/quote-1/send?preview=1", { method: "POST", body: JSON.stringify({ preview: true }), headers: { "content-type": "application/json" } });
    const res = await sendQuote(req, { params: { id: "quote-1" } });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.preview).toBe(true);
    expectNoSecret(body);
    expect(m.rendered.length).toBeGreaterThan(0);
    for (const html of m.rendered) expectNoSecret(html);
  });

  it("send route real send: what the email provider receives (body, subject, attachments)", async () => {
    const req = new NextRequest("http://localhost/api/admin/quotes/quote-1/send", { method: "POST", body: JSON.stringify({}), headers: { "content-type": "application/json" } });
    const res = await sendQuote(req, { params: { id: "quote-1" } });
    expect(res.status).toBe(200);
    expect(m.sent).toHaveLength(1);
    const email = m.sent[0] as { html: string; subject: string; attachments?: Array<{ filename: string; content: Buffer }> };
    expectNoSecret(email.html);
    expectNoSecret(email.subject);
    for (const attachment of email.attachments ?? []) expectNoSecret(attachment.content.toString("utf8"));
    expectNoSecret(await res.json());
  });

  it("client documents mailer: the quote email and its PDF", async () => {
    const preview = await previewDocument("c1", "QUOTE", "quote-1");
    expect(preview.html).toContain("Deep clean");
    expectNoSecret(preview);
    expect(m.rendered.length).toBeGreaterThan(0);
    for (const html of m.rendered) expectNoSecret(html);
  });

  it("client portal My quotes route", async () => {
    m.requireRole.mockResolvedValue({ user: { id: "client-user", role: "CLIENT" } });
    const res = await clientQuotesGet(new NextRequest("http://localhost/api/client/quotes"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.quotes).toHaveLength(1);
    expect(m.db.quote.findMany.mock.calls[0][0].select.internalNotes).toBeUndefined();
    expectNoSecret(body);
  });

  it("client Approvals and dashboard (listQuotesWaiting)", async () => {
    const rows = await listQuotesWaiting("c1", new Date("2026-11-13T00:00:00.000Z"));
    expect(rows).toHaveLength(1);
    expect(m.db.quote.findMany.mock.calls[0][0].select.internalNotes).toBeUndefined();
    expectNoSecret(rows);
  });

  it("message templates: {{quote.internalNotes}} resolves to nothing, and strict campaigns refuse it", async () => {
    const text = await resolveTemplate("Hi {{quote.totalAmount | currency}} {{quote.internalNotes}}|", { quote: { id: "quote-1" } });
    expect(text).toBe("Hi $528.00 |");
    await expect(resolveTemplate("{{quote.internalNotes}}", { quote: { id: "quote-1" } }, { strictVariables: true })).rejects.toThrow(/Unknown campaign variable/);
  });
});
