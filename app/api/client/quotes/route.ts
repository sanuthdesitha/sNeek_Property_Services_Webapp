import { NextRequest, NextResponse } from "next/server";
import { Role, QuoteStatus } from "@prisma/client";
import { z } from "zod";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { getClientPortalContext } from "@/lib/client/portal";

/** Strip the internal [[META:...]] marker from notes before showing a client. */
function cleanNotes(notes: string | null): string | null {
  if (!notes) return null;
  return notes.replace(/\[\[META:[\s\S]+?\]\]/g, "").trim() || null;
}

const VISIBLE_STATUSES: QuoteStatus[] = [
  QuoteStatus.SENT,
  QuoteStatus.ACCEPTED,
  QuoteStatus.DECLINED,
  QuoteStatus.CONVERTED,
];

// ─── GET: the logged-in client's quotes ────────────────────────────────────────
export async function GET() {
  try {
    const session = await requireRole([Role.CLIENT]);
    const portal = await getClientPortalContext(session.user.id);
    if (!portal.clientId) return NextResponse.json({ quotes: [] });

    const quotes = await db.quote.findMany({
      where: { clientId: portal.clientId, status: { in: VISIBLE_STATUSES } },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        serviceType: true,
        lineItems: true,
        subtotal: true,
        gstAmount: true,
        totalAmount: true,
        notes: true,
        validUntil: true,
        status: true,
        createdAt: true,
        acceptedAt: true,
        declinedAt: true,
      },
    });

    // Best-effort: mark freshly-opened SENT quotes as viewed.
    const unviewed = quotes.filter((q) => q.status === QuoteStatus.SENT).map((q) => q.id);
    if (unviewed.length > 0) {
      await db.quote
        .updateMany({ where: { id: { in: unviewed }, viewedAt: null }, data: { viewedAt: new Date() } })
        .catch(() => undefined);
    }

    return NextResponse.json({
      quotes: quotes.map((q) => ({ ...q, notes: cleanNotes(q.notes) })),
    });
  } catch (err: any) {
    const status = err.message === "UNAUTHORIZED" ? 401 : err.message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json({ error: err.message ?? "Could not load quotes." }, { status });
  }
}

// ─── PATCH: client accepts or declines a quote ─────────────────────────────────
const patchSchema = z.object({ quoteId: z.string().min(1), action: z.enum(["ACCEPT", "DECLINE"]) });

export async function PATCH(req: NextRequest) {
  try {
    const session = await requireRole([Role.CLIENT]);
    const portal = await getClientPortalContext(session.user.id);
    const body = patchSchema.parse(await req.json());

    const quote = await db.quote.findUnique({
      where: { id: body.quoteId },
      select: { id: true, clientId: true, status: true, viewedAt: true },
    });
    if (!quote || !portal.clientId || quote.clientId !== portal.clientId) {
      return NextResponse.json({ error: "Quote not found." }, { status: 404 });
    }
    if (quote.status !== QuoteStatus.SENT) {
      return NextResponse.json({ error: "This quote can no longer be changed." }, { status: 400 });
    }

    const now = new Date();
    await db.quote.update({
      where: { id: quote.id },
      data:
        body.action === "ACCEPT"
          ? { status: QuoteStatus.ACCEPTED, acceptedAt: now, viewedAt: quote.viewedAt ?? now }
          : { status: QuoteStatus.DECLINED, declinedAt: now, viewedAt: quote.viewedAt ?? now },
    });
    return NextResponse.json({ ok: true, status: body.action === "ACCEPT" ? "ACCEPTED" : "DECLINED" });
  } catch (err: any) {
    const status = err.message === "UNAUTHORIZED" ? 401 : err.message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json({ error: err.message ?? "Could not update quote." }, { status });
  }
}
