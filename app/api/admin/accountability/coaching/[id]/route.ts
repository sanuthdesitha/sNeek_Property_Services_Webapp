import { NextRequest, NextResponse } from "next/server";
import { CoachingRecordStatus, Role } from "@prisma/client";
import { z } from "zod";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";

/**
 * Admin coaching record update (Phase 7b).
 *
 * PATCH — status / notes / outcome / retrainingRequired / reviewDate. Outcome
 * is validated against the four allowed strings. ADMIN + OPS_MANAGER only;
 * every change writes a COACHING_RECORD_UPDATE AuditLog row.
 */

const OUTCOMES = ["NONE", "RETRAINED", "SUSPENDED", "TERMINATED"] as const;

const patchSchema = z
  .object({
    status: z.nativeEnum(CoachingRecordStatus).optional(),
    notes: z.string().trim().max(8000).optional().nullable(),
    outcome: z.enum(OUTCOMES).optional().nullable(),
    retrainingRequired: z.boolean().optional(),
    reviewDate: z.string().datetime().optional().nullable(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: "No fields to update." });

function errorStatus(err: any): number {
  if (err?.message === "UNAUTHORIZED") return 401;
  if (err?.message === "FORBIDDEN") return 403;
  return 400;
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const body = patchSchema.parse(await req.json().catch(() => ({})));

    const existing = await db.coachingRecord.findUnique({ where: { id: params.id } });
    if (!existing) {
      return NextResponse.json({ error: "Coaching record not found." }, { status: 404 });
    }

    const data: Record<string, unknown> = {};
    if (body.status !== undefined) data.status = body.status;
    if (body.notes !== undefined) data.notes = body.notes;
    if (body.outcome !== undefined) data.outcome = body.outcome;
    if (body.retrainingRequired !== undefined) data.retrainingRequired = body.retrainingRequired;
    if (body.reviewDate !== undefined) {
      if (body.reviewDate === null) {
        data.reviewDate = null;
      } else {
        const d = new Date(body.reviewDate);
        data.reviewDate = Number.isNaN(d.getTime()) ? existing.reviewDate : d;
      }
    }

    const updated = await db.$transaction(async (tx) => {
      const record = await tx.coachingRecord.update({
        where: { id: existing.id },
        data,
        include: {
          cleaner: { select: { id: true, name: true, email: true } },
          createdBy: { select: { id: true, name: true, email: true } },
        },
      });

      await tx.auditLog.create({
        data: {
          userId: session.user.id,
          action: "COACHING_RECORD_UPDATE",
          entity: "CoachingRecord",
          entityId: record.id,
          before: {
            status: existing.status,
            notes: existing.notes,
            outcome: existing.outcome,
            retrainingRequired: existing.retrainingRequired,
            reviewDate: existing.reviewDate,
          } as any,
          after: {
            status: record.status,
            notes: record.notes,
            outcome: record.outcome,
            retrainingRequired: record.retrainingRequired,
            reviewDate: record.reviewDate,
          } as any,
        },
      });

      return record;
    });

    return NextResponse.json(updated);
  } catch (err: any) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: "Invalid update." }, { status: 400 });
    }
    return NextResponse.json(
      { error: err.message ?? "Could not update coaching record." },
      { status: errorStatus(err) }
    );
  }
}
