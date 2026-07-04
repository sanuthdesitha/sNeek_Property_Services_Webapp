/**
 * TemplateKind configs (rebrand doc 03 §3.3) — one editor, many kinds.
 * Each kind declares its data contract (zod), chrome, allowed blocks, and a
 * sample fixture. The contract drives the editor's variable picker,
 * render-time validation, and publish-time linting. Adding a template kind is
 * DATA — no per-kind editor code.
 *
 * Phase-1 pilots (§5.1): email.clientInvoiceIssued, doc.clientInvoice,
 * sms.jobReminder — one kind per family proves all three in one system.
 */

import { z } from "zod";
import type { Block, BlockType, Channel, TemplateKind } from "./model";

export interface TemplateKindConfig {
  kind: TemplateKind;
  family: "email" | "document" | "sms";
  label: string;
  chrome: "emailShell" | "a4Page" | "none";
  dataContract: z.ZodTypeAny;
  /** Canned fixture for editor preview / test renders. */
  sampleData: () => unknown;
  allowedBlocks: BlockType[];
  /** Publish lint fails when these are missing (e.g. invoice needs totals). */
  requiredBlocks?: BlockType[];
  channels: Channel[];
}

// ---------------------------------------------------------------------------
// Shared contract fragments
// ---------------------------------------------------------------------------

const invoiceLine = z.object({
  description: z.string(),
  propertyName: z.string().optional(),
  quantity: z.number(),
  unitAmount: z.number(),
  lineTotal: z.number(),
});

/** Computed by lib/billing — templates format, NEVER recompute money. */
const invoiceContract = z.object({
  invoice: z.object({
    number: z.string(),
    issuedAt: z.union([z.string(), z.date()]),
    dueAt: z.union([z.string(), z.date()]).optional(),
    periodStart: z.union([z.string(), z.date()]).optional(),
    periodEnd: z.union([z.string(), z.date()]).optional(),
    subtotal: z.number(),
    gstAmount: z.number(),
    totalAmount: z.number(),
    gstEnabled: z.boolean(),
    lines: z.array(invoiceLine),
  }),
  client: z.object({ name: z.string(), email: z.string().optional() }),
  payment: z.object({
    bankName: z.string().optional(),
    bsb: z.string().optional(),
    accountNumber: z.string().optional(),
    accountName: z.string().optional(),
    note: z.string().optional(),
    payUrl: z.string().optional(),
  }),
  actionUrl: z.string().optional(),
});

const SAMPLE_INVOICE = {
  invoice: {
    number: "INV-1042",
    issuedAt: "2026-07-01T00:00:00.000Z",
    dueAt: "2026-07-15T00:00:00.000Z",
    periodStart: "2026-06-01T00:00:00.000Z",
    periodEnd: "2026-06-30T00:00:00.000Z",
    subtotal: 560,
    gstAmount: 56,
    totalAmount: 616,
    gstEnabled: true,
    lines: [
      { description: "Airbnb turnover — 12 Marine Parade", propertyName: "12 Marine Parade", quantity: 3, unitAmount: 120, lineTotal: 360 },
      { description: "Deep clean — 88 Ocean View Rd", propertyName: "88 Ocean View Rd", quantity: 1, unitAmount: 200, lineTotal: 200 },
    ],
  },
  client: { name: "J. Harrington", email: "client@example.com" },
  payment: { bankName: "CBA", bsb: "062-000", accountNumber: "1234 5678", accountName: "sNeek Property Services", note: "Please quote the invoice number.", payUrl: "https://example.com/pay/INV-1042" },
  actionUrl: "https://example.com/portal/invoices/INV-1042",
};

const jobReminderContract = z.object({
  companyName: z.string(),
  jobType: z.string(),
  property: z.object({ shortName: z.string() }),
  when: z.union([z.string(), z.date()]),
  shortUrl: z.string(),
});

const quoteLine = z.object({
  label: z.string(),
  quantity: z.number(),
  unitAmount: z.number(),
  lineTotal: z.number(),
});

/** Computed by lib/pricing — templates format, never recompute money. */
const quoteContract = z.object({
  quote: z.object({
    number: z.string(),
    serviceType: z.string(),
    issuedAt: z.union([z.string(), z.date()]),
    validUntil: z.union([z.string(), z.date()]),
    subtotal: z.number(),
    gstAmount: z.number(),
    totalAmount: z.number(),
    gstEnabled: z.boolean(),
    notes: z.string(),
    lines: z.array(quoteLine),
  }),
  client: z.object({ name: z.string(), address: z.string() }),
  actionUrl: z.string(),
});

const SAMPLE_QUOTE = {
  quote: {
    number: "Q-3007",
    serviceType: "Airbnb Turnover",
    issuedAt: "2026-07-01T00:00:00.000Z",
    validUntil: "2026-07-15T00:00:00.000Z",
    subtotal: 420,
    gstAmount: 42,
    totalAmount: 462,
    gstEnabled: true,
    notes: "Includes linen change and restock check. Excludes exterior windows.",
    lines: [
      { label: "Standard turnover clean (2 bd / 1 ba)", quantity: 1, unitAmount: 260, lineTotal: 260 },
      { label: "Linen change & staging", quantity: 1, unitAmount: 90, lineTotal: 90 },
      { label: "Consumables restock", quantity: 1, unitAmount: 70, lineTotal: 70 },
    ],
  },
  client: { name: "James Harrington", address: "12 Marine Parade, Coogee NSW" },
  actionUrl: "https://example.com/quote/Q-3007",
};

const reportMedia = z.object({
  url: z.string(),
  type: z.enum(["PHOTO", "VIDEO"]).optional(),
  caption: z.string().optional(),
});

/** Normalized by lib/reports/generator.ts extractClientReportData. */
const clientReportContract = z.object({
  report: z.object({
    property: z.object({
      name: z.string(),
      suburb: z.string(),
      jobType: z.string(),
      cleanDate: z.string(),
      cleaner: z.string(),
      client: z.string(),
    }),
    summary: z.object({ sections: z.number(), photos: z.number(), qaPassed: z.boolean().nullable() }),
    sections: z.array(
      z.object({
        title: z.string(),
        items: z.array(
          z.object({
            label: z.string(),
            checked: z.boolean().optional(),
            value: z.string().optional(),
            note: z.string().optional(),
            media: z.array(reportMedia).optional(),
          }),
        ),
      }),
    ),
    photos: z.array(reportMedia),
    qa: z
      .object({
        score: z.number().nullable(),
        passed: z.boolean().nullable(),
        categories: z.array(z.object({ label: z.string(), score: z.number() })),
      })
      .nullable(),
    hasQa: z.boolean(),
  }),
  actionUrl: z.string(),
});

const SAMPLE_CLIENT_REPORT = {
  report: {
    property: { name: "12 Marine Parade", suburb: "Coogee", jobType: "Airbnb Turnover", cleanDate: "2 July 2026", cleaner: "Ana R.", client: "James Harrington" },
    summary: { sections: 2, photos: 3, qaPassed: true },
    sections: [
      {
        title: "Kitchen",
        items: [
          { label: "Benches & splashback wiped", checked: true, media: [{ url: "https://x/k1.jpg", type: "PHOTO", caption: "Benchtop" }] },
          { label: "Oven cleaned", checked: true },
          { label: "Bin emptied & relined", checked: false, note: "No liners on site" },
        ],
      },
      {
        title: "Bathroom",
        items: [
          { label: "Shower glass", checked: true },
          { label: "Toilet sanitised", checked: true },
          { label: "Towels restocked", value: "4 towels", checked: undefined },
        ],
      },
    ],
    photos: [
      { url: "https://x/a.jpg", type: "PHOTO", caption: "Living room" },
      { url: "https://x/b.jpg", type: "PHOTO", caption: "Bedroom" },
      { url: "https://x/c.jpg", type: "PHOTO", caption: "Kitchen" },
    ],
    qa: { score: 96, passed: true, categories: [{ label: "Kitchen", score: 98 }, { label: "Bathroom", score: 94 }] },
    hasQa: true,
  },
  actionUrl: "https://example.com/portal/reports/abc",
};

const qaChecklistSection = z.object({
  title: z.string(),
  items: z.array(
    z.object({
      label: z.string(),
      checked: z.boolean().optional(),
      value: z.string().optional(),
      note: z.string().optional(),
      media: z.array(reportMedia).optional(),
    }),
  ),
});

/** Normalized by lib/reports/qa-report-data.ts extractQaReportData. */
const qaReportContract = z.object({
  report: z.object({
    property: z.object({ name: z.string(), suburb: z.string(), jobType: z.string(), date: z.string() }),
    meta: z.object({ cleaner: z.string(), inspector: z.string(), onSiteMinutes: z.string() }),
    qa: z
      .object({
        score: z.number().nullable(),
        passed: z.boolean().nullable(),
        categories: z.array(z.object({ label: z.string(), score: z.number() })),
        rework: z
          .object({ required: z.boolean(), severity: z.string(), areas: z.array(z.string()), note: z.string() })
          .nullable(),
      })
      .nullable(),
    hasQa: z.boolean(),
    notes: z.string(),
    sections: z.array(qaChecklistSection),
    findings: z.array(qaChecklistSection),
    hasFindings: z.boolean(),
    photos: z.array(reportMedia),
  }),
  actionUrl: z.string(),
});

const SAMPLE_QA_REPORT = {
  report: {
    property: { name: "12 Marine Parade", suburb: "Coogee", jobType: "Airbnb Turnover", date: "2 July 2026" },
    meta: { cleaner: "Ana R.", inspector: "Marco P.", onSiteMinutes: "18 min" },
    qa: {
      score: 88,
      passed: true,
      categories: [{ label: "Kitchen", score: 92 }, { label: "Bathroom", score: 84 }],
      rework: { required: true, severity: "MINOR", areas: ["Shower glass"], note: "Water spots on the shower screen." },
    },
    hasQa: true,
    notes: "Overall a strong clean; minor touch-up on the shower screen.",
    sections: [
      { title: "Kitchen", items: [{ label: "Benchtops", checked: true }, { label: "Oven", checked: true }, { label: "Rating", value: "4 / 5" }] },
      { title: "Bathroom", items: [{ label: "Shower glass", checked: false }, { label: "Toilet", checked: true }] },
    ],
    findings: [
      {
        title: "Damage findings",
        items: [{ label: "Master bathroom", checked: false, value: "MEDIUM", note: "Chip on the vanity edge.", media: [{ url: "https://x/d1.jpg", type: "PHOTO" }] }],
      },
    ],
    hasFindings: true,
    photos: [
      { url: "https://x/qa1.jpg", type: "PHOTO" },
      { url: "https://x/qa2.jpg", type: "PHOTO" },
    ],
  },
  actionUrl: "",
};

// ---------------------------------------------------------------------------
// Pilot kinds
// ---------------------------------------------------------------------------

const EMAIL_BLOCKS: BlockType[] = [
  "header", "hero", "heading", "text", "statRow", "infoCard", "lineItems",
  "totals", "button", "callout", "image", "divider", "spacer", "footer",
];

const DOC_BLOCKS: BlockType[] = [
  "header", "hero", "heading", "text", "statRow", "infoCard", "lineItems",
  "totals", "terms", "button", "callout", "image", "divider", "spacer",
  "pageBreak", "footer", "checklistSection", "photoGrid", "qaScoreCard",
];

export const TEMPLATE_KINDS: Record<string, TemplateKindConfig> = {
  "email.clientInvoiceIssued": {
    kind: "email.clientInvoiceIssued",
    family: "email",
    label: "Client invoice issued (email)",
    chrome: "emailShell",
    dataContract: invoiceContract,
    sampleData: () => SAMPLE_INVOICE,
    allowedBlocks: EMAIL_BLOCKS,
    requiredBlocks: ["button", "footer"],
    channels: ["email"],
  },
  "doc.clientInvoice": {
    kind: "doc.clientInvoice",
    family: "document",
    label: "Client invoice (PDF)",
    chrome: "a4Page",
    dataContract: invoiceContract,
    sampleData: () => SAMPLE_INVOICE,
    allowedBlocks: DOC_BLOCKS,
    requiredBlocks: ["lineItems", "totals"],
    channels: ["pdf", "web"],
  },
  "doc.quote": {
    kind: "doc.quote",
    family: "document",
    label: "Quote / proposal (PDF)",
    chrome: "a4Page",
    dataContract: quoteContract,
    sampleData: () => SAMPLE_QUOTE,
    allowedBlocks: DOC_BLOCKS,
    requiredBlocks: ["lineItems", "totals"],
    channels: ["pdf", "web"],
  },
  "doc.clientReport": {
    kind: "doc.clientReport",
    family: "document",
    label: "Client report (PDF)",
    chrome: "a4Page",
    dataContract: clientReportContract,
    sampleData: () => SAMPLE_CLIENT_REPORT,
    allowedBlocks: DOC_BLOCKS,
    requiredBlocks: ["checklistSection"],
    channels: ["pdf", "web"],
  },
  "doc.qaReport": {
    kind: "doc.qaReport",
    family: "document",
    label: "QA inspection report (PDF)",
    chrome: "a4Page",
    dataContract: qaReportContract,
    sampleData: () => SAMPLE_QA_REPORT,
    allowedBlocks: DOC_BLOCKS,
    requiredBlocks: ["qaScoreCard"],
    channels: ["pdf", "web"],
  },
  "sms.jobReminder": {
    kind: "sms.jobReminder",
    family: "sms",
    label: "Job reminder (SMS)",
    chrome: "none",
    dataContract: jobReminderContract,
    sampleData: () => ({
      companyName: "sNeek",
      jobType: "Turnover",
      property: { shortName: "12 Marine Pde" },
      when: "2026-07-05T09:00:00.000Z",
      shortUrl: "https://snk.au/j/abc123",
    }),
    allowedBlocks: ["textBlock"],
    requiredBlocks: ["textBlock"],
    channels: ["sms"],
  },
};

export function getKindConfig(kind: string): TemplateKindConfig | null {
  return TEMPLATE_KINDS[kind] ?? null;
}

// ---------------------------------------------------------------------------
// Default SYSTEM docs for the pilots (§4.1 #16, §4.2, §4.3) — seed material.
// ---------------------------------------------------------------------------

function block(type: BlockType, id: string, props: Record<string, unknown>, when?: string): Block {
  return when ? { id, type, props, when } : { id, type, props };
}

/** Shell C "Document delivery" — client invoice issued email (§4.1 #16). */
export function defaultClientInvoiceIssuedEmail(): Block[] {
  return [
    block("header", "hd", { variant: "email", showLogo: true }),
    block("hero", "hr", {
      eyebrow: "TAX INVOICE {{invoice.number}}",
      headline: "{{invoice.totalAmount | money}}",
      subline: "Due {{invoice.dueAt | date}} · service period {{invoice.periodStart | date}} – {{invoice.periodEnd | date}}.",
    }),
    block("infoCard", "if", {
      title: "INVOICE DETAILS",
      rows: [
        { label: "Invoice", value: "{{invoice.number}}" },
        { label: "Billed to", value: "{{client.name}}" },
        { label: "Amount due", value: "{{invoice.totalAmount | money}}" },
        { label: "Due date", value: "{{invoice.dueAt | date}}" },
      ],
    }),
    block("button", "bt", { text: "View & pay", href: "{{actionUrl}}" }),
    block("text", "tx", { text: "Questions about this invoice? Just reply to this email." }),
    block("footer", "ft", { showIdentity: true }),
  ];
}

/** A4 client invoice document (§4.2). */
export function defaultClientInvoiceDoc(): Block[] {
  return [
    block("header", "hd", { variant: "document", eyebrow: "TAX INVOICE", docNumber: "{{invoice.number}}", docDate: "Issued {{invoice.issuedAt | date}}", showLogo: true }),
    block("infoCard", "bill", {
      title: "BILL TO",
      rows: [
        { label: "Client", value: "{{client.name}}" },
        { label: "Period", value: "{{invoice.periodStart | date}} – {{invoice.periodEnd | date}}" },
        { label: "Due", value: "{{invoice.dueAt | date}}" },
      ],
    }),
    block("lineItems", "li", {
      bind: "invoice.lines",
      columns: [
        { label: "Description", path: "description", format: "text", align: "left" },
        { label: "Qty", path: "quantity", format: "number", align: "right" },
        { label: "Unit", path: "unitAmount", format: "money", align: "right" },
        { label: "Total", path: "lineTotal", format: "money", align: "right" },
      ],
      emptyText: "No line items.",
    }),
    block("totals", "tt", {
      rows: [
        { label: "Subtotal", value: "{{invoice.subtotal | money}}", emphasis: false, when: "" },
        { label: "GST", value: "{{invoice.gstAmount | money}}", emphasis: false, when: "invoice.gstEnabled" },
        { label: "Amount due", value: "{{invoice.totalAmount | money}}", emphasis: true, when: "" },
      ],
    }),
    block("infoCard", "pay", {
      title: "PAYMENT",
      rows: [
        { label: "Bank", value: "{{payment.bankName}}" },
        { label: "BSB", value: "{{payment.bsb}}" },
        { label: "Account", value: "{{payment.accountNumber}}" },
        { label: "Name", value: "{{payment.accountName}}" },
      ],
    }),
    block("terms", "tm", { text: "{{payment.note}}" }),
    block("footer", "ft", { showIdentity: true, showPageNumbers: true }),
  ];
}

/** A4 client cleaning report (§4.2) — checklist + evidence + QA. */
export function defaultClientReportDoc(): Block[] {
  return [
    block("header", "hd", { variant: "document", eyebrow: "CLEANING REPORT", docDate: "{{report.property.cleanDate}}", showLogo: true }),
    block("hero", "hr", {
      eyebrow: "{{report.property.jobType}}",
      headline: "{{report.property.name}}",
      subline: "{{report.property.suburb}} · cleaned by {{report.property.cleaner}}",
    }),
    block("statRow", "st", {
      items: [
        { label: "Areas", value: "{{report.summary.sections}}", delta: "" },
        { label: "Photos", value: "{{report.summary.photos}}", delta: "" },
        { label: "Client", value: "{{report.property.client}}", delta: "" },
      ],
    }),
    block("qaScoreCard", "qa", { bind: "report.qa" }, "report.hasQa"),
    block("heading", "ch", { text: "Checklist", level: 2 }),
    block("checklistSection", "cs", { bind: "report.sections", showMedia: true }),
    block("heading", "ph", { text: "Photo evidence", level: 2 }),
    block("photoGrid", "pg", { bind: "report.photos", columns: 3, showCaption: true }),
    block("footer", "ft", { showIdentity: true, showPageNumbers: true }),
  ];
}

/** A4 QA inspection report (§4.2) — verdict, checklist, findings, evidence. */
export function defaultQaReportDoc(): Block[] {
  return [
    block("header", "hd", { variant: "document", eyebrow: "QA INSPECTION", docDate: "{{report.property.date}}", showLogo: true }),
    block("hero", "hr", { eyebrow: "{{report.property.jobType}}", headline: "{{report.property.name}}", subline: "{{report.property.suburb}}" }),
    block("infoCard", "meta", {
      title: "INSPECTION",
      rows: [
        { label: "Cleaner", value: "{{report.meta.cleaner}}" },
        { label: "Inspector", value: "{{report.meta.inspector}}" },
        { label: "On site", value: "{{report.meta.onSiteMinutes}}" },
      ],
    }),
    block("qaScoreCard", "qa", { bind: "report.qa" }),
    block("callout", "nt", { tone: "info", title: "Inspector notes", text: "{{report.notes}}" }, "report.notes"),
    block("heading", "sh", { text: "Section results", level: 2 }),
    block("checklistSection", "cs", { bind: "report.sections", showMedia: false }),
    block("heading", "fh", { text: "Findings", level: 2 }, "report.hasFindings"),
    block("checklistSection", "fs", { bind: "report.findings", showMedia: true }, "report.hasFindings"),
    block("heading", "ph", { text: "Inspector photos", level: 2 }),
    block("photoGrid", "pg", { bind: "report.photos", columns: 3, showCaption: false }),
    block("footer", "ft", { showIdentity: true, showPageNumbers: true }),
  ];
}

/** 1-segment job reminder SMS (§4.3). */
export function defaultJobReminderSms(): Block[] {
  return [
    block("textBlock", "sms", {
      text: '{{companyName}}: {{jobType}} at {{property.shortName}} {{when | datetime:"EEE d MMM h:mma"}}. Details: {{shortUrl}}',
    }),
  ];
}

/** A4 quote / proposal document (§4.2, sales-critical). */
export function defaultQuoteDoc(): Block[] {
  return [
    block("header", "hd", {
      variant: "document",
      eyebrow: "PROPOSAL",
      docNumber: "{{quote.number}}",
      docDate: "Issued {{quote.issuedAt | date}}",
      showLogo: true,
    }),
    block("hero", "hr", {
      eyebrow: "{{quote.serviceType}}",
      headline: "Proposal for {{client.name}}",
      subline: "{{client.address}}",
    }),
    block("infoCard", "meta", {
      title: "QUOTE DETAILS",
      rows: [
        { label: "Service", value: "{{quote.serviceType}}" },
        { label: "Prepared for", value: "{{client.name}}" },
        { label: "Valid until", value: "{{quote.validUntil | date}}" },
      ],
    }),
    block("lineItems", "li", {
      bind: "quote.lines",
      columns: [
        { label: "Item", path: "label", format: "text", align: "left" },
        { label: "Qty", path: "quantity", format: "number", align: "right" },
        { label: "Unit", path: "unitAmount", format: "money", align: "right" },
        { label: "Total", path: "lineTotal", format: "money", align: "right" },
      ],
      emptyText: "No line items.",
    }),
    block("totals", "tt", {
      rows: [
        { label: "Subtotal", value: "{{quote.subtotal | money}}", emphasis: false, when: "" },
        { label: "GST", value: "{{quote.gstAmount | money}}", emphasis: false, when: "quote.gstEnabled" },
        { label: "Total", value: "{{quote.totalAmount | money}}", emphasis: true, when: "" },
      ],
    }),
    block("callout", "note", { tone: "info", title: "What's included", text: "{{quote.notes}}" }, "quote.notes"),
    block("button", "cta", { text: "Accept this quote", href: "{{actionUrl}}", showUrlInPdf: true }),
    block("terms", "tm", { text: "This quote is valid until {{quote.validUntil | date}}. Prices in AUD." }),
    block("footer", "ft", { showIdentity: true, showPageNumbers: true }),
  ];
}
