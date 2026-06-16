import { NextRequest, NextResponse } from "next/server";
import { Role, QuoteStatus } from "@prisma/client";
import { z } from "zod";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";

const updateQuoteSchema = z.object({
  status: z.nativeEnum(QuoteStatus).optional(),
  notes: z.string().trim().optional().nullable(),
  validUntil: z.string().datetime().optional().nullable(),
  // Assign/reassign the quote to a client (null to unassign).
  clientId: z.string().trim().min(1).optional().nullable(),
});

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

