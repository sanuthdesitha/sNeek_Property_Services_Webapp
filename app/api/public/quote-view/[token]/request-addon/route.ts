import { NextRequest, NextResponse } from "next/server";
import { format } from "date-fns";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { getAppSettings } from "@/lib/settings";
import { sendEmailDetailed } from "@/lib/notifications/email";
import {
  appendNoteLinePreservingMeta,
  findQuoteByToken,
  resolveRequestedAddOns,
} from "../../_lib";

export const dynamic = "force-dynamic";

function escapeHtml(value: unknown) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Client add-on request from the public quote page. Token-scoped, no auth.
 * Emails the accounts inbox and appends a line to the quote notes without
 * disturbing the [[META:...]] block.
 */
export async function POST(req: NextRequest, { params }: { params: { token: string } }) {
  try {
    const body = await req.json().catch(() => ({}));
    const labels = resolveRequestedAddOns(body?.items);
    const note = typeof body?.note === "string" ? body.note.trim().slice(0, 1000) : "";
    if (labels.length === 0) {
      return NextResponse.json({ error: "Pick at least one add-on to request." }, { status: 400 });
    }

    const quote = await findQuoteByToken(params.token);
    if (!quote) {
      return NextResponse.json({ error: "Quote not found." }, { status: 404 });
    }

    const recipient = quote.client?.name ?? quote.lead?.name ?? "Client";
    const when = format(new Date(), "dd-MM-yyyy HH:mm");
    const noteLine =
      `Client requested add-ons: ${labels.join(", ")} on ${when}` +
      (note ? ` — "${note.replace(/"/g, "'")}"` : "");

    // Append to notes, preserving the [[META:...]] block byte-for-byte.
    await db.quote.update({
      where: { id: quote.id },
      data: { notes: appendNoteLinePreservingMeta(quote.notes, noteLine) },
    });

    logger.info(
      {
        action: "QUOTE_CLIENT_ADDON_REQUEST",
        entity: "Quote",
        entityId: quote.id,
        items: labels,
        note: note || undefined,
        recipient,
      },
      "Client requested add-ons from a public quote link"
    );

    // Best-effort email to the accounts inbox.
    try {
      const settings = await getAppSettings();
      if (settings.accountsEmail) {
        const shortRef = String(quote.id).slice(-7).toUpperCase();
        await sendEmailDetailed({
          to: settings.accountsEmail,
          subject: `Add-on request on quote ${shortRef} from ${recipient}`,
          html: `
            <h2 style="margin:0 0 12px 0;">Add-on request — quote ${escapeHtml(shortRef)}</h2>
            <p style="margin:0 0 8px 0;"><strong>${escapeHtml(recipient)}</strong> asked about these add-ons on their ${escapeHtml(String(quote.serviceType).replace(/_/g, " ").toLowerCase())} quote:</p>
            <ul style="margin:0 0 12px 0;padding-left:20px;">
              ${labels.map((l) => `<li style="margin:2px 0;">${escapeHtml(l)}</li>`).join("")}
            </ul>
            ${note ? `<p style="margin:0 0 8px 0;"><strong>Client note:</strong> ${escapeHtml(note)}</p>` : ""}
            <p style="margin:0;color:#6b7280;font-size:13px;">Quote ID: ${escapeHtml(quote.id)}</p>
          `,
        });
      }
    } catch (err) {
      logger.warn({ err, quoteId: quote.id }, "Failed to email accounts about an add-on request");
    }

    return NextResponse.json({ ok: true, requested: labels });
  } catch (err: any) {
    return NextResponse.json({ error: "Could not send your request." }, { status: 500 });
  }
}
