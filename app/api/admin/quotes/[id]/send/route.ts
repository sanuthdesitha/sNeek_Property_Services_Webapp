import { NextRequest, NextResponse } from "next/server";
import { NotificationChannel, NotificationStatus, QuoteStatus, Role } from "@prisma/client";
import { randomBytes } from "crypto";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { sendEmailDetailed } from "@/lib/notifications/email";
import { buildQuoteHtml } from "@/lib/pricing/quote-report";
import { buildAddOnListHtml } from "@/lib/pricing/addons-pdf";
import { EXTRAS_BY_CATEGORY } from "@/lib/pricing/extras-catalog";
import { getAppSettings } from "@/lib/settings";
import { resolveAppUrl } from "@/lib/app-url";
import { resolveClientDeliveryRecipients } from "@/lib/commercial/delivery-profiles";
import { getChecklist } from "@/lib/checklists/store";
import { buildChecklistHtml, type ChecklistPdfExtra } from "@/lib/checklists/checklist-pdf";
import type { ServiceChecklist } from "@/lib/checklists/types";
import { z } from "zod";

const schema = z.object({
  to: z.union([z.string().trim().email(), z.array(z.string().trim().email()).min(1)]).optional(),
  subject: z.string().trim().optional(),
  // Preview mode: render the email (subject, html body, attachment manifest,
  // public link) WITHOUT sending anything. Also honoured via ?preview=1.
  preview: z.boolean().optional(),
});

/** 32-char URL-safe token for the public /q/<token> quote page. */
function newPublicToken(): string {
  return randomBytes(24).toString("base64url");
}

/** Pull the structured extras the admin/client added, out of the quote notes META. */
function extrasFromNotes(notes: string | null | undefined): ChecklistPdfExtra[] {
  if (!notes) return [];
  const match = notes.match(/\[\[META:([\s\S]+?)\]\]/);
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

/**
 * If the admin edited the checklist for this quote, a `checklist` override lives
 * in the notes META. Rebuild a full ServiceChecklist from it so it can be passed
 * to buildChecklistHtml in place of the base template. Returns null when there is
 * no override (→ caller falls back to the base template — backward-compatible).
 */
function checklistOverrideFromNotes(
  notes: string | null | undefined,
  jobType: string,
): ServiceChecklist | null {
  if (!notes) return null;
  const match = notes.match(/\[\[META:([\s\S]+?)\]\]/);
  if (!match) return null;
  try {
    const meta = JSON.parse(match[1]) as { checklist?: unknown };
    const ov = meta.checklist as
      | {
          summary?: unknown;
          sections?: unknown;
          notCovered?: unknown;
        }
      | undefined;
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
    const notCovered = Array.isArray(ov.notCovered)
      ? ov.notCovered.filter((n): n is string => typeof n === "string" && n.trim().length > 0)
      : [];
    return {
      jobType,
      summary: typeof ov.summary === "string" && ov.summary.trim() ? ov.summary.trim() : undefined,
      notCovered,
      sections,
    };
  } catch {
    return null;
  }
}

type ReferenceImage = { key: string; url: string; label?: string };

/** Parse the quote's referenceImages Json column into a safe, typed list. */
function parseReferenceImages(raw: unknown): ReferenceImage[] {
  if (!Array.isArray(raw)) return [];
  const out: ReferenceImage[] = [];
  for (const entry of raw) {
    const e = (entry ?? {}) as Record<string, unknown>;
    const url = typeof e.url === "string" ? e.url.trim() : "";
    if (!/^https?:\/\//i.test(url)) continue;
    out.push({
      key: typeof e.key === "string" ? e.key : url,
      url,
      label: typeof e.label === "string" && e.label.trim() ? e.label.trim() : undefined,
    });
  }
  return out.slice(0, 12);
}

/** Safe attachment filename for a reference image (label → slug + real ext). */
function referenceImageFilename(image: ReferenceImage, index: number): string {
  const source = image.label || image.key.split("/").pop() || `reference-${index + 1}`;
  const extMatch = (image.key.split("/").pop() ?? image.url).match(/\.(jpe?g|png|gif|webp|heic|bmp)$/i);
  const ext = extMatch ? extMatch[0].toLowerCase() : ".jpg";
  const base =
    source
      .replace(/\.(jpe?g|png|gif|webp|heic|bmp)$/i, "")
      .replace(/[^a-z0-9\- _]/gi, "")
      .trim()
      .replace(/\s+/g, "-")
      .slice(0, 60) || `reference-${index + 1}`;
  return `reference-${index + 1}-${base}${ext}`.toLowerCase();
}

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const session = await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const body = schema.parse(await req.json().catch(() => ({})));
    const previewMode =
      body.preview === true || ["1", "true"].includes(req.nextUrl.searchParams.get("preview") ?? "");

    const quote = await db.quote.findUnique({
      where: { id: params.id },
      include: {
        client: { select: { id: true, name: true, email: true } },
        lead: { select: { name: true, email: true } },
      },
    });
    if (!quote) {
      return NextResponse.json({ error: "Quote not found" }, { status: 404 });
    }
    if (!previewMode && quote.status === QuoteStatus.DRAFT && session.user.role !== Role.ADMIN) {
      return NextResponse.json(
        { error: "Admin approval is required before sending a draft quote." },
        { status: 403 }
      );
    }

    const explicitRecipients = body.to
      ? Array.isArray(body.to)
        ? body.to
        : [body.to]
      : [];
    const profileRecipients =
      explicitRecipients.length > 0
        ? explicitRecipients
        : await resolveClientDeliveryRecipients({
            clientId: quote.client?.id,
            fallbackEmail: quote.client?.email ?? null,
            kind: "invoice",
          });
    const recipients = profileRecipients.length
      ? profileRecipients
      : quote.lead?.email
        ? [quote.lead.email]
        : [];

    if (!recipients.length && !previewMode) {
      return NextResponse.json({ error: "No recipient email found. Please provide an email address." }, { status: 400 });
    }

    // ── Public "view online" link — mint the token on first send/preview ──
    let publicToken = quote.publicToken;
    if (!publicToken) {
      publicToken = newPublicToken();
      await db.quote.update({ where: { id: quote.id }, data: { publicToken } });
    }
    const publicUrl = resolveAppUrl(`/q/${publicToken}`, req);

    const settings = await getAppSettings();
    const subject = body.subject || settings.quoteDefaultEmailSubject;
    const branding = {
      companyName: settings.companyName,
      logoUrl: settings.logoUrl || settings.reportLogoUrl,
      companyAddress: settings.invoicing?.companyAddress,
    };
    // Email body carries the "View your quote online" button; the PDF doesn't.
    const html = buildQuoteHtml(quote, { ...branding, viewOnlineUrl: publicUrl });

    const attachments: Array<{ filename: string; content: Buffer }> = [];

    // Quote PDF — the same document, sans the email-only CTA button.
    try {
      const { renderPdfFromHtml } = await import("@/lib/reports/pdf");
      const quotePdf = await renderPdfFromHtml(buildQuoteHtml(quote, branding), "quote PDF");
      if (quotePdf) attachments.push({ filename: "quote.pdf", content: quotePdf as Buffer });
    } catch {
      // quote PDF is non-critical — the email body carries the full quote
    }

    // Best-effort: attach the service checklist (covered/not-covered + extras)
    // as a PDF. Never blocks the quote email if PDF rendering is unavailable.
    try {
      const checklist =
        checklistOverrideFromNotes(quote.notes, String(quote.serviceType)) ??
        (await getChecklist(String(quote.serviceType)));
      if (checklist) {
        const checklistHtml = buildChecklistHtml(checklist, {
          companyName: settings.companyName,
          logoUrl: settings.logoUrl || settings.reportLogoUrl,
          serviceLabel: String(quote.serviceType).replace(/_/g, " "),
          extras: extrasFromNotes(quote.notes),
        });
        const { renderPdfFromHtml } = await import("@/lib/reports/pdf");
        const pdf = await renderPdfFromHtml(checklistHtml, "quote checklist PDF");
        if (pdf) attachments.push({ filename: "service-checklist.pdf", content: pdf as Buffer });
      }
    } catch {
      // checklist PDF is non-critical
    }

    // Optional add-ons list — full catalog grouped by category; prices only
    // when this quote opted in (showAddOnPrices).
    try {
      const addOnsHtml = buildAddOnListHtml({
        companyName: settings.companyName,
        logoUrl: settings.logoUrl || settings.reportLogoUrl,
        showPrices: Boolean(quote.showAddOnPrices),
        categories: EXTRAS_BY_CATEGORY,
        publicUrl,
      });
      const { renderPdfFromHtml } = await import("@/lib/reports/pdf");
      const pdf = await renderPdfFromHtml(addOnsHtml, "quote add-on list PDF");
      if (pdf) attachments.push({ filename: "optional-add-ons.pdf", content: pdf as Buffer });
    } catch {
      // add-on list PDF is non-critical
    }

    // Reference images — fetched server-side, best-effort; failures are skipped.
    const referenceImages = parseReferenceImages(quote.referenceImages);
    for (let i = 0; i < referenceImages.length; i++) {
      const image = referenceImages[i];
      try {
        const res = await fetch(image.url, { signal: AbortSignal.timeout(15000) });
        if (!res.ok) continue;
        const buffer = Buffer.from(await res.arrayBuffer());
        if (!buffer.length) continue;
        attachments.push({ filename: referenceImageFilename(image, i), content: buffer });
      } catch {
        // skip unreachable reference images
      }
    }

    const attachmentManifest = attachments.map((a) => ({
      filename: a.filename,
      size: a.content.length,
    }));

    if (previewMode) {
      // Render-only: nothing is sent, no notification row, no status change.
      return NextResponse.json({
        preview: true,
        subject,
        html,
        attachments: attachmentManifest,
        publicUrl,
        recipients,
      });
    }

    const sentResult = await sendEmailDetailed({
      to: recipients,
      subject,
      html,
      attachments: attachments.length ? attachments : undefined,
    });
    const sent = sentResult.ok;

    await db.notification.create({
      data: {
        channel: NotificationChannel.EMAIL,
        subject,
        body: `Quote ${quote.id} sent to ${recipients.join(", ")} (attachments: ${
          attachmentManifest.map((a) => a.filename).join(", ") || "none"
        })`,
        status: sent ? NotificationStatus.SENT : NotificationStatus.FAILED,
        sentAt: sent ? new Date() : undefined,
        errorMsg: sent ? undefined : sentResult.error ?? "Email provider returned failure.",
      },
    });

    if (!sent) {
      return NextResponse.json({ error: sentResult.error ?? "Email provider failed to send quote." }, { status: 502 });
    }

    await db.quote.update({
      where: { id: quote.id },
      data: {
        status: quote.status === QuoteStatus.DRAFT ? QuoteStatus.SENT : quote.status,
      },
    });

    return NextResponse.json({
      ok: true,
      publicUrl,
      attachments: attachmentManifest,
      recipients,
    });
  } catch (err: any) {
    const status = err.message === "UNAUTHORIZED" ? 401 : err.message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json({ error: err.message }, { status });
  }
}
