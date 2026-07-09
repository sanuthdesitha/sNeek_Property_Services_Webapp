import { NextRequest, NextResponse } from "next/server";
import { NotificationChannel, NotificationStatus, QuoteStatus, Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { sendEmailDetailed } from "@/lib/notifications/email";
import { buildQuoteHtml } from "@/lib/pricing/quote-report";
import { getAppSettings } from "@/lib/settings";
import { resolveClientDeliveryRecipients } from "@/lib/commercial/delivery-profiles";
import { getChecklist } from "@/lib/checklists/store";
import { buildChecklistHtml, type ChecklistPdfExtra } from "@/lib/checklists/checklist-pdf";
import type { ServiceChecklist } from "@/lib/checklists/types";
import { z } from "zod";

const schema = z.object({
  to: z.union([z.string().trim().email(), z.array(z.string().trim().email()).min(1)]).optional(),
  subject: z.string().trim().optional(),
});

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

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const session = await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const body = schema.parse(await req.json().catch(() => ({})));

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
    if (quote.status === QuoteStatus.DRAFT && session.user.role !== Role.ADMIN) {
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

    if (!recipients.length) {
      return NextResponse.json({ error: "No recipient email found. Please provide an email address." }, { status: 400 });
    }

    const settings = await getAppSettings();
    const subject = body.subject || settings.quoteDefaultEmailSubject;
    const html = buildQuoteHtml(quote, {
      companyName: settings.companyName,
      logoUrl: settings.reportLogoUrl || settings.logoUrl,
      companyAddress: settings.invoicing?.companyAddress,
    });

    // Best-effort: attach the service checklist (covered/not-covered + extras)
    // as a PDF. Never blocks the quote email if PDF rendering is unavailable.
    const attachments: Array<{ filename: string; content: Buffer }> = [];
    try {
      const checklist =
        checklistOverrideFromNotes(quote.notes, String(quote.serviceType)) ??
        (await getChecklist(String(quote.serviceType)));
      if (checklist) {
        const checklistHtml = buildChecklistHtml(checklist, {
          companyName: settings.companyName,
          logoUrl: settings.reportLogoUrl || settings.logoUrl,
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
        body: `Quote ${quote.id} sent to ${recipients.join(", ")}`,
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

    return NextResponse.json({ ok: true });
  } catch (err: any) {
    const status = err.message === "UNAUTHORIZED" ? 401 : err.message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json({ error: err.message }, { status });
  }
}
