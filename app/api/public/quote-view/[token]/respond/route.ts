import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { getAppSettings } from "@/lib/settings";
import { sendEmailDetailed } from "@/lib/notifications/email";
import { recordQuoteEvent } from "@/lib/quotes/events";
import { findQuoteByToken, isQuoteExpired } from "../../_lib";

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
 * Client Accept / Decline for a shared quote. Token-scoped, no auth.
 * Valid only while the quote is still SENT and not past validUntil.
 */
export async function POST(req: NextRequest, { params }: { params: { token: string } }) {
  try {
    const body = await req.json().catch(() => ({}));
    const decision = body?.decision === "ACCEPT" || body?.decision === "DECLINE" ? body.decision : null;
    const note =
      typeof body?.note === "string" ? body.note.trim().slice(0, 2000) : "";
    if (!decision) {
      return NextResponse.json({ error: "Invalid decision." }, { status: 400 });
    }

    const quote = await findQuoteByToken(params.token);
    if (!quote) {
      return NextResponse.json({ error: "Quote not found." }, { status: 404 });
    }
    if (quote.status !== "SENT") {
      return NextResponse.json(
        { error: "This quote has already been responded to.", status: quote.status },
        { status: 409 }
      );
    }
    if (isQuoteExpired(quote)) {
      return NextResponse.json(
        { error: "This quote has expired. Please contact us for an updated quote." },
        { status: 410 }
      );
    }

    const now = new Date();
    const accepted = decision === "ACCEPT";
    // Guard the status transition in the WHERE so two concurrent responses
    // can't both win (updateMany returns the affected count).
    const result = await db.quote.updateMany({
      where: { id: quote.id, status: "SENT" },
      data: accepted
        ? { status: "ACCEPTED", acceptedAt: now, viewedAt: quote.viewedAt ?? now }
        : { status: "DECLINED", declinedAt: now, viewedAt: quote.viewedAt ?? now },
    });
    if (result.count === 0) {
      return NextResponse.json(
        { error: "This quote has already been responded to." },
        { status: 409 }
      );
    }

    const recipient = quote.client?.name ?? quote.lead?.name ?? "Client";

    // Timeline: client accepted / declined. Best-effort, never blocks.
    await recordQuoteEvent(
      quote.id,
      accepted ? "ACCEPTED" : "DECLINED",
      note ? { note } : undefined
    );

    // AuditLog.userId is required (public visitors have no user), so journal
    // the response via the structured app log instead — same pattern as the
    // other public endpoints.
    logger.info(
      {
        action: "QUOTE_CLIENT_RESPONSE",
        entity: "Quote",
        entityId: quote.id,
        decision,
        note: note || undefined,
        recipient,
      },
      "Client responded to a public quote link"
    );

    // Best-effort notification to the accounts inbox — the response itself is
    // already committed, so email failures never surface to the client.
    try {
      const settings = await getAppSettings();
      if (settings.accountsEmail) {
        const shortRef = String(quote.id).slice(-7).toUpperCase();
        const verdict = accepted ? "ACCEPTED" : "DECLINED";
        await sendEmailDetailed({
          to: settings.accountsEmail,
          subject: `Quote ${shortRef} ${verdict.toLowerCase()} by ${recipient}`,
          html: `
            <h2 style="margin:0 0 12px 0;">Quote ${escapeHtml(shortRef)} ${verdict.toLowerCase()}</h2>
            <p style="margin:0 0 8px 0;"><strong>${escapeHtml(recipient)}</strong> has ${accepted ? "accepted" : "declined"} their ${escapeHtml(String(quote.serviceType).replace(/_/g, " ").toLowerCase())} quote (total $${Number(quote.totalAmount).toFixed(2)}).</p>
            ${note ? `<p style="margin:0 0 8px 0;"><strong>Client note:</strong> ${escapeHtml(note)}</p>` : ""}
            <p style="margin:0;color:#6b7280;font-size:13px;">Quote ID: ${escapeHtml(quote.id)}</p>
          `,
        });
      }
    } catch (err) {
      logger.warn({ err, quoteId: quote.id }, "Failed to email accounts about a quote response");
    }

    return NextResponse.json({
      ok: true,
      status: accepted ? "ACCEPTED" : "DECLINED",
      respondedAt: now.toISOString(),
    });
  } catch (err: any) {
    return NextResponse.json({ error: "Could not record your response." }, { status: 500 });
  }
}
