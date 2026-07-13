/**
 * Document re-send — one place to re-email a client any document they ask for:
 * the quote, the invoice, the (updated) service checklist, the add-ons list, the
 * online add-on link, or the clean report. Each renders through the SAME builder
 * the original send uses, so the re-sent copy always reflects the latest data
 * (e.g. a checklist edited after the first send). Always offers a preview first.
 *
 * Server-only (PDF rendering + db). The client Documents panel drives it through
 * the /api/admin/clients/[id]/documents[/send] routes.
 */
import "server-only";
import { randomBytes } from "crypto";
import { NotificationChannel, NotificationStatus, Role } from "@prisma/client";
import { format } from "date-fns";
import { toZonedTime } from "date-fns-tz";
import { db } from "@/lib/db";
import { getAppSettings } from "@/lib/settings";
import { resolveAppUrl } from "@/lib/app-url";
import { sendEmailDetailed } from "@/lib/notifications/email";
import { renderEmailTemplate } from "@/lib/email-templates";
import { resolveClientDeliveryRecipients } from "@/lib/commercial/delivery-profiles";
import { buildQuoteHtml } from "@/lib/pricing/quote-report";
import { buildAddOnListHtml } from "@/lib/pricing/addons-pdf";
import { EXTRAS_BY_CATEGORY } from "@/lib/pricing/extras-catalog";
import { buildChecklistHtml, type ChecklistPdfExtra } from "@/lib/checklists/checklist-pdf";
import type { ServiceChecklist } from "@/lib/checklists/types";
import { getChecklist } from "@/lib/checklists/store";
import { getClientInvoice, renderClientInvoicePdf } from "@/lib/billing/client-invoices";
import { getStoredJobReport } from "@/lib/reports/access";
import { getJobReportPdfBuffer } from "@/lib/reports/pdf";
import { getJobReference } from "@/lib/jobs/job-number";

const TZ = "Australia/Sydney";

export type DocumentType = "QUOTE" | "CHECKLIST" | "ADDONS_LIST" | "ONLINE_LINK" | "INVOICE" | "REPORT";

export type DocumentTypeMeta = {
  type: DocumentType;
  label: string;
  description: string;
  /** Which target list this document is picked from. */
  targetKind: "quote" | "invoice" | "report";
};

export const DOCUMENT_TYPES: Record<DocumentType, DocumentTypeMeta> = {
  QUOTE: { type: "QUOTE", label: "Quote (PDF)", description: "Re-send the quote document.", targetKind: "quote" },
  CHECKLIST: { type: "CHECKLIST", label: "Service checklist", description: "Re-send the latest what's-included checklist.", targetKind: "quote" },
  ADDONS_LIST: { type: "ADDONS_LIST", label: "Add-ons list", description: "The full optional add-ons menu.", targetKind: "quote" },
  ONLINE_LINK: { type: "ONLINE_LINK", label: "Online quote / add-on link", description: "A link to view the quote and request add-ons online.", targetKind: "quote" },
  INVOICE: { type: "INVOICE", label: "Invoice (PDF)", description: "Re-send the invoice.", targetKind: "invoice" },
  REPORT: { type: "REPORT", label: "Clean report (PDF)", description: "Re-send the completed clean report.", targetKind: "report" },
};

export const DOCUMENT_TYPE_LIST: DocumentTypeMeta[] = Object.values(DOCUMENT_TYPES);

type Attachment = { filename: string; content: Buffer };
type DocEmail = { ok: boolean; subject: string; html: string; attachments: Attachment[]; recipients: string[]; reason?: string };

const META_REGEX = /\[\[META:([\s\S]+?)\]\]/;

/** Extras (with instructions) out of a quote's notes META — for the checklist PDF. */
function extrasFromNotes(notes: string | null | undefined): ChecklistPdfExtra[] {
  if (!notes) return [];
  const match = notes.match(META_REGEX);
  if (!match) return [];
  try {
    const meta = JSON.parse(match[1]) as { extras?: unknown };
    if (!Array.isArray(meta.extras)) return [];
    const out: ChecklistPdfExtra[] = [];
    for (const raw of meta.extras) {
      const e = (raw ?? {}) as Record<string, unknown>;
      const label = typeof e.label === "string" ? e.label.trim() : "";
      if (!label) continue;
      out.push({ label, instructions: typeof e.instructions === "string" ? e.instructions : undefined });
    }
    return out;
  } catch {
    return [];
  }
}

/** Per-quote checklist override from notes META (mirrors the send route). */
function checklistOverrideFromNotes(notes: string | null | undefined, jobType: string): ServiceChecklist | null {
  if (!notes) return null;
  const match = notes.match(META_REGEX);
  if (!match) return null;
  try {
    const meta = JSON.parse(match[1]) as { checklist?: unknown };
    const ov = meta.checklist as { summary?: unknown; sections?: unknown; notCovered?: unknown } | undefined;
    if (!ov || !Array.isArray(ov.sections)) return null;
    const sections = ov.sections
      .map((rawSection, si) => {
        const s = (rawSection ?? {}) as { title?: unknown; items?: unknown };
        const items = Array.isArray(s.items)
          ? s.items
              .map((rawItem, ii) => {
                const it = (rawItem ?? {}) as { label?: unknown; covered?: unknown };
                const label = typeof it.label === "string" ? it.label.trim() : "";
                if (!label) return null;
                return { id: `ov-${si}-${ii}`, label, covered: Boolean(it.covered) };
              })
              .filter((x): x is { id: string; label: string; covered: boolean } => x !== null)
          : [];
        return { id: `ov-sec-${si}`, title: typeof s.title === "string" ? s.title : "", items };
      })
      .filter((s) => s.items.length > 0);
    if (sections.length === 0) return null;
    const notCovered = Array.isArray(ov.notCovered) ? ov.notCovered.filter((n): n is string => typeof n === "string" && n.trim().length > 0) : [];
    return { jobType, summary: typeof ov.summary === "string" && ov.summary.trim() ? ov.summary.trim() : undefined, notCovered, sections };
  } catch {
    return null;
  }
}

async function renderPdf(html: string, label: string): Promise<Buffer | null> {
  try {
    const { renderPdfFromHtml } = await import("@/lib/reports/pdf");
    const pdf = await renderPdfFromHtml(html, label);
    return (pdf as Buffer) ?? null;
  } catch {
    return null;
  }
}

function newPublicToken(): string {
  return randomBytes(24).toString("base64url");
}

async function docRecipients(clientId: string, kind: "report" | "invoice" | "general"): Promise<string[]> {
  if (kind === "report" || kind === "invoice") {
    const emails = await resolveClientDeliveryRecipients({ clientId, fallbackEmail: null, kind });
    if (emails.length) return emails;
  }
  const users = await db.user.findMany({ where: { clientId, role: Role.CLIENT, isActive: true }, select: { email: true } });
  return users.map((u) => u.email).filter((e): e is string => Boolean(e));
}

// ── Builders per document type ─────────────────────────────────────────────────

async function buildDocumentEmail(clientId: string, docType: DocumentType, targetId: string): Promise<DocEmail> {
  const settings = await getAppSettings();
  const companyName = settings.companyName || "sNeek Property Services";
  const logoUrl = settings.logoUrl || settings.reportLogoUrl;
  const branding = { companyName, logoUrl, companyAddress: settings.invoicing?.companyAddress };
  const empty = (reason: string): DocEmail => ({ ok: false, subject: "", html: "", attachments: [], recipients: [], reason });

  if (docType === "INVOICE") {
    const invoice = await getClientInvoice(targetId);
    if (!invoice || invoice.clientId !== clientId) return empty("Invoice not found for this client.");
    const recipients = await docRecipients(clientId, "invoice");
    const pdf = await renderClientInvoicePdf(invoice, companyName, logoUrl, settings.invoicing);
    const template = renderEmailTemplate(settings, "clientInvoiceIssued", {
      clientName: invoice.client.name,
      invoiceNumber: invoice.invoiceNumber,
      totalAmount: invoice.totalAmount.toFixed(2),
      actionLabel: "View invoice",
      actionUrl: resolveAppUrl("/client/finance"),
    });
    return {
      ok: recipients.length > 0,
      subject: template.subject,
      html: template.html,
      attachments: pdf ? [{ filename: `${invoice.invoiceNumber.toLowerCase()}.pdf`, content: pdf as Buffer }] : [],
      recipients,
      reason: recipients.length ? undefined : "No invoice recipient on file.",
    };
  }

  if (docType === "REPORT") {
    const job = await db.job.findUnique({
      where: { id: targetId },
      select: { id: true, jobNumber: true, jobType: true, scheduledDate: true, property: { select: { name: true, clientId: true } } },
    });
    if (!job || job.property?.clientId !== clientId) return empty("Report job not found for this client.");
    const report = await getStoredJobReport(targetId);
    if (!report?.pdfUrl && !report?.htmlContent) return empty("No report is available for this job yet.");
    const recipients = await docRecipients(clientId, "report");
    const ref = getJobReference(job);
    const pdf = await getJobReportPdfBuffer(report, targetId).catch(() => null);
    const template = renderEmailTemplate(settings, "cleaningReportShared", {
      clientName: "",
      jobNumber: ref,
      propertyName: job.property?.name ?? "",
      jobType: String(job.jobType).replace(/_/g, " "),
      cleanDate: format(toZonedTime(job.scheduledDate, TZ), "EEEE, dd MMMM yyyy"),
      reportLink: resolveAppUrl("/client/reports"),
      actionUrl: resolveAppUrl("/client/reports"),
      actionLabel: "Open client portal",
    });
    return {
      ok: recipients.length > 0,
      subject: template.subject,
      html: template.html,
      attachments: pdf ? [{ filename: `${ref.toLowerCase()}-report.pdf`, content: pdf as Buffer }] : [],
      recipients,
      reason: recipients.length ? undefined : "No client email on file.",
    };
  }

  // ── Quote-scoped documents (QUOTE / CHECKLIST / ADDONS_LIST / ONLINE_LINK) ──
  const quote = await db.quote.findUnique({ where: { id: targetId } });
  if (!quote || quote.clientId !== clientId) return empty("Quote not found for this client.");
  const recipients = await docRecipients(clientId, "invoice"); // quotes use the invoice delivery profile, like the send route
  const serviceLabel = String(quote.serviceType).replace(/_/g, " ");

  // Ensure a public token for the online link + the quote CTA.
  let publicToken = quote.publicToken;
  if (docType === "ONLINE_LINK" && !publicToken) {
    publicToken = newPublicToken();
    await db.quote.update({ where: { id: quote.id }, data: { publicToken } });
  }
  const publicUrl = publicToken ? resolveAppUrl(`/q/${publicToken}`) : null;

  if (docType === "QUOTE") {
    const html = buildQuoteHtml(quote, { ...branding, viewOnlineUrl: publicUrl ?? undefined });
    const pdf = await renderPdf(buildQuoteHtml(quote, branding), "quote PDF");
    return {
      ok: recipients.length > 0,
      subject: `${companyName}: Your quote`,
      html,
      attachments: pdf ? [{ filename: "quote.pdf", content: pdf }] : [],
      recipients,
      reason: recipients.length ? undefined : "No client email on file.",
    };
  }

  if (docType === "CHECKLIST") {
    const checklist = checklistOverrideFromNotes(quote.notes, String(quote.serviceType)) ?? (await getChecklist(String(quote.serviceType)));
    if (!checklist) return empty("No checklist is available for this service.");
    const checklistHtml = buildChecklistHtml(checklist, { companyName, logoUrl, serviceLabel, extras: extrasFromNotes(quote.notes) });
    const pdf = await renderPdf(checklistHtml, "quote checklist PDF");
    return {
      ok: recipients.length > 0,
      subject: `${companyName}: Your service checklist`,
      html: `<p>Please find the latest service checklist for your ${serviceLabel.toLowerCase()} attached.</p>`,
      attachments: pdf ? [{ filename: "service-checklist.pdf", content: pdf }] : [],
      recipients,
      reason: recipients.length ? undefined : "No client email on file.",
    };
  }

  if (docType === "ADDONS_LIST") {
    const addOnsHtml = buildAddOnListHtml({
      companyName,
      logoUrl,
      showPrices: Boolean(quote.showAddOnPrices),
      categories: EXTRAS_BY_CATEGORY,
      publicUrl: publicUrl ?? undefined,
    });
    const pdf = await renderPdf(addOnsHtml, "add-on list PDF");
    return {
      ok: recipients.length > 0,
      subject: `${companyName}: Optional add-ons`,
      html: `<p>Here's our full list of optional add-ons you can add to your clean.${publicUrl ? ` You can also request them online: <a href="${publicUrl}">view your quote</a>.` : ""}</p>`,
      attachments: pdf ? [{ filename: "optional-add-ons.pdf", content: pdf }] : [],
      recipients,
      reason: recipients.length ? undefined : "No client email on file.",
    };
  }

  // ONLINE_LINK
  return {
    ok: recipients.length > 0 && Boolean(publicUrl),
    subject: `${companyName}: View your quote & request add-ons online`,
    html: `<p>You can view your quote and request any optional add-ons online here:</p><p><a href="${publicUrl}">${publicUrl}</a></p>`,
    attachments: [],
    recipients,
    reason: !publicUrl ? "Could not create the online link." : recipients.length ? undefined : "No client email on file.",
  };
}

// ── Preview / send ──────────────────────────────────────────────────────────────

export type DocumentPreview = { ok: boolean; docType: DocumentType; subject: string; html: string; attachments: { filename: string; size: number }[]; recipients: string[]; reason?: string };

export async function previewDocument(clientId: string, docType: DocumentType, targetId: string): Promise<DocumentPreview> {
  const doc = await buildDocumentEmail(clientId, docType, targetId);
  return {
    ok: doc.ok,
    docType,
    subject: doc.subject,
    html: doc.html,
    attachments: doc.attachments.map((a) => ({ filename: a.filename, size: a.content.length })),
    recipients: doc.recipients,
    reason: doc.reason,
  };
}

export type DocumentSendResult = { ok: boolean; recipients: string[]; error?: string };

export async function sendDocument(clientId: string, docType: DocumentType, targetId: string): Promise<DocumentSendResult> {
  const doc = await buildDocumentEmail(clientId, docType, targetId);
  if (!doc.ok || doc.recipients.length === 0) return { ok: false, recipients: [], error: doc.reason ?? "Nothing to send." };

  // Manual re-send — always delivers (transactional, ungated).
  const result = await sendEmailDetailed({
    to: doc.recipients,
    subject: doc.subject,
    html: doc.html,
    attachments: doc.attachments.length ? doc.attachments : undefined,
    transactional: true,
  });

  await db.notification
    .create({
      data: {
        channel: NotificationChannel.EMAIL,
        subject: `[Re-sent: ${DOCUMENT_TYPES[docType].label}] ${doc.subject}`,
        body: `${DOCUMENT_TYPES[docType].label} re-sent to ${doc.recipients.join(", ")}`,
        status: result.ok ? NotificationStatus.SENT : NotificationStatus.FAILED,
        sentAt: result.ok ? new Date() : undefined,
        errorMsg: result.ok ? undefined : result.error ?? "Email delivery failed.",
        externalId: result.externalId ?? undefined,
        deliveryStatus: result.ok ? "PENDING" : undefined,
      },
    })
    .catch(() => {});

  if (!result.ok) return { ok: false, recipients: doc.recipients, error: result.error ?? "Email provider failed." };
  return { ok: true, recipients: doc.recipients };
}
