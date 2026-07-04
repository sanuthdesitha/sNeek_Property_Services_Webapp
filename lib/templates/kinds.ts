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
  "pageBreak", "footer",
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

/** 1-segment job reminder SMS (§4.3). */
export function defaultJobReminderSms(): Block[] {
  return [
    block("textBlock", "sms", {
      text: '{{companyName}}: {{jobType}} at {{property.shortName}} {{when | datetime:"EEE d MMM h:mma"}}. Details: {{shortUrl}}',
    }),
  ];
}
