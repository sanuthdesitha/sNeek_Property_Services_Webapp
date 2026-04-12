import { NextRequest, NextResponse } from "next/server";
import { Role, StockRunStatus } from "@prisma/client";
import { z } from "zod";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";

const lineSchema = z.object({
  propertyStockId: z.string().cuid(),
  countedOnHand: z.number().min(0),
  note: z.string().trim().max(500).optional().nullable(),
});

const createSchema = z.object({
  propertyId: z.string().cuid(),
  title: z.string().trim().min(1).max(200),
  notes: z.string().trim().max(2000).optional().nullable(),
  lines: z.array(lineSchema),
});

const applySchema = z.object({
  runId: z.string().cuid(),
});

export async function GET(req: NextRequest) {
  try {
    await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const { searchParams } = new URL(req.url);
    const propertyId = searchParams.get("propertyId");

    const where: Record<string, unknown> = {};
    if (propertyId) where.propertyId = propertyId;

    const runs = await db.stockRun.findMany({
      where,
      include: {
        property: { select: { id: true, name: true, suburb: true } },
        requestedBy: { select: { id: true, name: true, email: true } },
        lines: {
          include: {
            propertyStock: {
              include: {
                item: true,
              },
            },
          },
        },
      },
      orderBy: { updatedAt: "desc" },
      take: 100,
    });

    return NextResponse.json(
      runs.map((run) => ({
        ...run,
        lines: run.lines.map((line) => ({
          ...line,
          variance: line.countedOnHand != null ? Number(line.countedOnHand) - Number(line.expectedOnHand) : null,
        })),
      }))
    );
  } catch (err: any) {
    const status =
      err.message === "UNAUTHORIZED" ? 401 : err.message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json({ error: err.message }, { status });
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const body = createSchema.parse(await req.json());

    // Load current stock levels for the property
    const currentStocks = await db.propertyStock.findMany({
      where: { propertyId: body.propertyId },
      include: { item: true },
    });
    const stockById = new Map(currentStocks.map((s) => [s.id, s]));

    const run = await db.$transaction(async (tx) => {
      const created = await tx.stockRun.create({
        data: {
          propertyId: body.propertyId,
          requestedByUserId: session.user.id,
          title: body.title,
          notes: body.notes || null,
          status: StockRunStatus.DRAFT,
          requestedByAdmin: true,
          lines: {
            create: body.lines.map((line) => {
              const stock = stockById.get(line.propertyStockId);
              return {
                propertyStockId: line.propertyStockId,
                expectedOnHand: stock?.onHand ?? 0,
                countedOnHand: line.countedOnHand,
                parLevel: stock?.parLevel ?? null,
                reorderThreshold: stock?.reorderThreshold ?? null,
                note: line.note || null,
              };
            }),
          },
        },
        include: {
          property: { select: { id: true, name: true, suburb: true } },
          lines: {
            include: {
              propertyStock: { include: { item: true } },
            },
          },
        },
      });
      return created;
    });

    return NextResponse.json(run, { status: 201 });
  } catch (err: any) {
    const status =
      err.message === "UNAUTHORIZED" ? 401 : err.message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json({ error: err.message }, { status });
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const session = await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const body = applySchema.parse(await req.json());

    const run = await db.stockRun.findUnique({
      where: { id: body.runId },
      include: { lines: true, property: { select: { id: true, name: true } } },
    });
    if (!run) {
      return NextResponse.json({ error: "Stock run not found." }, { status: 404 });
    }
    if (run.status !== StockRunStatus.SUBMITTED && run.status !== StockRunStatus.DRAFT) {
      return NextResponse.json({ error: "Stock run cannot be applied in its current status." }, { status: 409 });
    }

    await db.$transaction(async (tx) => {
      // Update property stock levels from counted values
      for (const line of run.lines) {
        if (line.countedOnHand != null) {
          await tx.propertyStock.update({
            where: { id: line.propertyStockId },
            data: {
              onHand: line.countedOnHand,
              parLevel: line.parLevel ?? undefined,
              reorderThreshold: line.reorderThreshold ?? undefined,
            },
          });
        }
      }

      await tx.stockRun.update({
        where: { id: body.runId },
        data: {
          status: StockRunStatus.APPLIED,
          appliedAt: new Date(),
        },
      });

      await tx.auditLog.create({
        data: {
          userId: session.user.id,
          action: "APPLY_STOCK_COUNT",
          entity: "StockRun",
          entityId: body.runId,
          after: {
            propertyId: run.propertyId,
            propertyName: run.property.name,
            lineCount: run.lines.length,
          },
        },
      });
    });

    return NextResponse.json({ ok: true });
  } catch (err: any) {
    const status =
      err.message === "UNAUTHORIZED" ? 401 : err.message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json({ error: err.message }, { status });
  }
}
