import { NextRequest, NextResponse } from "next/server";
import { Prisma, Role, QuoteStatus } from "@prisma/client";
import { randomBytes } from "crypto";
import { z } from "zod";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";

const updateQuoteSchema = z.object({
  status: z.nativeEnum(QuoteStatus).optional(),
  notes: z.string().trim().optional().nullable(),
  validUntil: z.string().datetime().optional().nullable(),
  // Assign/reassign the quote to a client (null to unassign).
  clientId: z.string().trim().min(1).optional().nullable(),
  // Pricing-variable selections snapshot (variable id → option/qty/custom).
  serviceContext: z.record(z.union([z.string(), z.number(), z.boolean()])).optional().nullable(),
  // Client reference photos: [{ key, url, label }] (null/[] clears them).
  referenceImages: z
    .array(
      z.object({
        key: z.string().trim().min(1),
        url: z.string().trim().url(),
        label: z.string().trim().max(160).optional(),
      })
    )
    .max(12)
    .optional()
    .nullable(),
  // Show add-on prices to the client (email + online).
  showAddOnPrices: z.boolean().optional(),
  // When true, mint the shareable /q/<token> public token if one doesn't exist
  // yet (idempotent — an existing token is never rotated).
  generatePublicToken: z.boolean().optional(),
});

/** 32-char URL-safe token for the public /q/<token> quote page. (Not exported —
 *  route files may only export HTTP handlers; the send route has its own.) */
function newPublicToken(): string {
  return randomBytes(24).toString("base64url");
}

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const quote = await db.quote.findUnique({
      where: { id: params.id },
      include: {
        client: { select: { id: true, name: true, email: true } },
        lead: { select: { id: true, name: true, email: true } },
      },
    });
    if (!quote) return NextResponse.json({ error: "Quote not found." }, { status: 404 });
    return NextResponse.json(quote);
  } catch (err: any) {
    const status = err.message === "UNAUTHORIZED" ? 401 : err.message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json({ error: err.message }, { status });
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const body = updateQuoteSchema.parse(await req.json());
    const data: Record<string, unknown> = {};
    if (body.status !== undefined) {
      data.status = body.status;
      // Backfill lifecycle timestamps on status transition (set once, idempotent).
      const now = new Date();
      const existing = await db.quote.findUnique({
        where: { id: params.id },
        select: { viewedAt: true, acceptedAt: true, declinedAt: true },
      });
      if (body.status === QuoteStatus.ACCEPTED && !existing?.acceptedAt) {
        data.acceptedAt = now;
        if (!existing?.viewedAt) data.viewedAt = now;
      }
      if (body.status === QuoteStatus.DECLINED && !existing?.declinedAt) {
        data.declinedAt = now;
        if (!existing?.viewedAt) data.viewedAt = now;
      }
    }
    if (body.notes !== undefined) data.notes = body.notes || null;
    if (body.validUntil !== undefined) data.validUntil = body.validUntil ? new Date(body.validUntil) : null;
    if (body.serviceContext !== undefined) {
      data.serviceContext = body.serviceContext === null ? Prisma.JsonNull : body.serviceContext;
    }
    if (body.referenceImages !== undefined) {
      data.referenceImages = body.referenceImages === null ? Prisma.JsonNull : body.referenceImages;
    }
    if (body.showAddOnPrices !== undefined) data.showAddOnPrices = body.showAddOnPrices;
    if (body.generatePublicToken) {
      const existing = await db.quote.findUnique({
        where: { id: params.id },
        select: { publicToken: true, status: true },
      });
      if (!existing) return NextResponse.json({ error: "Quote not found." }, { status: 404 });
      if (!existing.publicToken) data.publicToken = newPublicToken();
      // Minting a shareable link IS a share: the public /q/<token> view rejects
      // DRAFT quotes and the client can't approve until the quote is SENT, so
      // promote DRAFT → SENT here (unless the caller set an explicit status).
      if (existing.status === QuoteStatus.DRAFT && data.status === undefined) {
        data.status = QuoteStatus.SENT;
      }
    }
    if (body.clientId !== undefined) {
      if (body.clientId) {
        const client = await db.client.findUnique({ where: { id: body.clientId }, select: { id: true, isActive: true } });
        if (!client || !client.isActive) {
          return NextResponse.json({ error: "Selected client does not exist or is inactive." }, { status: 400 });
        }
        data.clientId = client.id;
      } else {
        data.clientId = null;
      }
    }

    const quote = await db.quote.update({
      where: { id: params.id },
      data,
    });
    return NextResponse.json(quote);
  } catch (err: any) {
    const status =
      err.message === "UNAUTHORIZED" ? 401 : err.message === "FORBIDDEN" ? 403 : err.code === "P2025" ? 404 : 400;
    return NextResponse.json({ error: err.message }, { status });
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    await db.quote.delete({ where: { id: params.id } });
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    const status =
      err.message === "UNAUTHORIZED" ? 401 : err.message === "FORBIDDEN" ? 403 : err.code === "P2025" ? 404 : 400;
    return NextResponse.json({ error: err.message }, { status });
  }
}

