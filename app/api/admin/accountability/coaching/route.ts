import { NextRequest, NextResponse } from "next/server";
import { CoachingRecordStatus, CoachingRecordType, Prisma, Role } from "@prisma/client";
import { z } from "zod";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { notifyCoachingCreated } from "@/lib/notifications/accountability";

/**
 * Admin coaching / accountability record register (Phase 7b).
 *
 * GET  — filterable list (cleanerId, type, status, take/skip default 50),
 *        newest first, with cleaner + createdBy names.
 * POST — create a coaching record. Records are recommendations authored by
 *        managers, NOT automatic discipline; the cleaner acknowledges later.
 *
 * ADMIN + OPS_MANAGER only. Every write leaves an AuditLog row.
 */

const createSchema = z.object({
  cleanerId: z.string().cuid(),
  type: z.nativeEnum(CoachingRecordType),
  reason: z.string().trim().min(1).max(8000),
  notes: z.string().trim().max(8000).optional().nullable(),
  issueIds: z.array(z.string()).max(200).optional(),
  patternKey: z.string().trim().max(200).optional().nullable(),
  retrainingRequired: z.boolean().optional(),
  reviewDate: z.string().datetime().optional().nullable(),
});

function errorStatus(err: any): number {
  if (err?.message === "UNAUTHORIZED") return 401;
  if (err?.message === "FORBIDDEN") return 403;
  return 400;
}

export async function GET(req: NextRequest) {
  try {
    await requireRole([Role.ADMIN, Role.OPS_MANAGER]);

    const { searchParams } = new URL(req.url);
    const cleanerId = searchParams.get("cleanerId") || undefined;
    const typeRaw = searchParams.get("type") || undefined;
    const statusRaw = searchParams.get("status") || undefined;

    const takeRaw = Number(searchParams.get("take"));
    const skipRaw = Number(searchParams.get("skip"));
    const take = Number.isFinite(takeRaw) && takeRaw > 0 ? Math.min(takeRaw, 200) : 50;
    const skip = Number.isFinite(skipRaw) && skipRaw > 0 ? skipRaw : 0;

    const type =
      typeRaw && (Object.values(CoachingRecordType) as string[]).includes(typeRaw)
        ? (typeRaw as CoachingRecordType)
        : undefined;
    const status =
      statusRaw && (Object.values(CoachingRecordStatus) as string[]).includes(statusRaw)
        ? (statusRaw as CoachingRecordStatus)
        : undefined;

    const where: Prisma.CoachingRecordWhereInput = {
      ...(cleanerId ? { cleanerId } : {}),
      ...(type ? { type } : {}),
      ...(status ? { status } : {}),
    };

    const [total, records] = await Promise.all([
      db.coachingRecord.count({ where }),
      db.coachingRecord.findMany({
        where,
        orderBy: { createdAt: "desc" },
        take,
        skip,
        include: {
          cleaner: { select: { id: true, name: true, email: true } },
          createdBy: { select: { id: true, name: true, email: true } },
        },
      }),
    ]);

    const rows = records.map((r) => ({
      id: r.id,
      type: r.type,
      status: r.status,
      reason: r.reason,
      notes: r.notes,
      issueIds: r.issueIds ?? null,
      patternKey: r.patternKey,
      retrainingRequired: r.retrainingRequired,
      reviewDate: r.reviewDate,
      acknowledgedAt: r.acknowledgedAt,
      outcome: r.outcome,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
      cleanerId: r.cleanerId,
      cleaner: r.cleaner ? { id: r.cleaner.id, name: r.cleaner.name ?? r.cleaner.email } : null,
      createdBy: r.createdBy ? { id: r.createdBy.id, name: r.createdBy.name ?? r.createdBy.email } : null,
    }));

    return NextResponse.json({
      records: rows,
      pagination: { total, take, skip, hasMore: skip + rows.length < total },
    });
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message ?? "Failed to load coaching records." },
      { status: errorStatus(err) }
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const body = createSchema.parse(await req.json().catch(() => ({})));

    const cleaner = await db.user.findFirst({
      where: { id: body.cleanerId, role: Role.CLEANER },
      select: { id: true },
    });
    if (!cleaner) {
      return NextResponse.json({ error: "Cleaner not found." }, { status: 400 });
    }

    const reviewDate = body.reviewDate ? new Date(body.reviewDate) : null;

    const created = await db.$transaction(async (tx) => {
      const record = await tx.coachingRecord.create({
        data: {
          cleanerId: body.cleanerId,
          createdById: session.user.id,
          type: body.type,
          status: CoachingRecordStatus.OPEN,
          reason: body.reason,
          notes: body.notes ?? null,
          ...(body.issueIds && body.issueIds.length ? { issueIds: body.issueIds as any } : {}),
          patternKey: body.patternKey ?? null,
          retrainingRequired: body.retrainingRequired ?? false,
          reviewDate: reviewDate && !Number.isNaN(reviewDate.getTime()) ? reviewDate : null,
        },
        include: {
          cleaner: { select: { id: true, name: true, email: true } },
          createdBy: { select: { id: true, name: true, email: true } },
        },
      });

      await tx.auditLog.create({
        data: {
          userId: session.user.id,
          action: "COACHING_RECORD_CREATE",
          entity: "CoachingRecord",
          entityId: record.id,
          after: {
            cleanerId: record.cleanerId,
            type: record.type,
            status: record.status,
            retrainingRequired: record.retrainingRequired,
            reviewDate: record.reviewDate,
            issueIds: record.issueIds ?? null,
            patternKey: record.patternKey,
          } as any,
        },
      });

      return record;
    });

    void notifyCoachingCreated({
      cleanerId: created.cleanerId,
      coachingId: created.id,
      type: created.type,
      reason: created.reason,
      retrainingRequired: created.retrainingRequired,
    }).catch(console.error);

    return NextResponse.json(created, { status: 201 });
  } catch (err: any) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: "Invalid coaching record." }, { status: 400 });
    }
    return NextResponse.json(
      { error: err.message ?? "Could not create coaching record." },
      { status: errorStatus(err) }
    );
  }
}
