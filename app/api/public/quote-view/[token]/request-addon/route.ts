import { NextRequest, NextResponse } from "next/server";
import { loadNotificationWording } from "@/lib/notifications/wording/render";
import { format } from "date-fns";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { getAppSettings } from "@/lib/settings";
import { sendEmailDetailed } from "@/lib/notifications/email";
import { recordQuoteEvent } from "@/lib/quotes/events";
import {
  mergeRequestedAddOns,
  parseRequestedAddOns,
  resolveRequestedAddOnEntries,
} from "@/lib/quotes/requested-addons";
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
    const now = new Date();
    const when = format(now, "dd-MM-yyyy HH:mm");
    const noteLine =
      `Client requested add-ons: ${labels.join(", ")} on ${when}` +
      (note ? ` — "${note.replace(/"/g, "'")}"` : "");

    // Structured pending requests for the admin to price in + re-send. Catalog
    // matches carry their price; free-text comes in at 0 for the admin to set.
    const incoming = resolveRequestedAddOnEntries(body?.items, note || undefined, now.toISOString());
    const nextPending = mergeRequestedAddOns(parseRequestedAddOns(quote.requestedAddOns), incoming);

    // Append the human note (preserving [[META:...]]) AND store the structured
    // pending list so the admin's quote detail surfaces an actionable request.
    await db.quote.update({
      where: { id: quote.id },
      data: {
        notes: appendNoteLinePreservingMeta(quote.notes, noteLine),
        requestedAddOns: nextPending as unknown as object,
      },
    });

    // Timeline: client requested add-ons. Best-effort, never blocks.
    await recordQuoteEvent(quote.id, "ADDON_REQUESTED", {
      items: labels,
      ...(note ? { note } : {}),
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
        const wording = await loadNotificationWording("leads.alerts");
        const email = wording.render("addon", "EMAIL", {
          quoteRef: shortRef,
          clientName: recipient,
          serviceType: String(quote.serviceType).replace(/_/g, " ").toLowerCase(),
          addonList: labels.map((l) => `<li style="margin:2px 0;">${escapeHtml(l)}</li>`).join(""),
          clientNoteParagraph: wording.line("client-note", "EMAIL", { note }, Boolean(note)),
          quoteId: quote.id,
        });
        await sendEmailDetailed({
          kind: "lead_alert",
          to: settings.accountsEmail,
          subject: email.subject,
          html: email.html,
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
