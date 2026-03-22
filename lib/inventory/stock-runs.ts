import { StockRunStatus, StockTxType, type Role } from "@prisma/client";
import { db } from "@/lib/db";

type Scope = {
  role: Role;
  userId: string;
  clientId?: string | null;
};

type StockRunLineInput = {
  id: string;
  countedOnHand?: number | null;
  parLevel?: number | null;
  reorderThreshold?: number | null;
  note?: string | null;
};

function canEditThresholds(scope: Scope) {
  return scope.role === "ADMIN" || scope.role === "OPS_MANAGER" || scope.role === "CLIENT";
}

async function accessibleProperties(scope: Scope) {
  if (scope.role === "ADMIN" || scope.role === "OPS_MANAGER") {
    return db.property.findMany({
      where: { isActive: true, inventoryEnabled: true },
      select: { id: true, name: true, suburb: true, clientId: true },
      orderBy: [{ name: "asc" }],
    });
  }

  if (scope.role === "CLIENT") {
    return db.property.findMany({
      where: {
        isActive: true,
        inventoryEnabled: true,
        clientId: scope.clientId ?? "__missing__",
      },
      select: { id: true, name: true, suburb: true, clientId: true },
      orderBy: [{ name: "asc" }],
    });
  }

  return db.property.findMany({
    where: {
      isActive: true,
      inventoryEnabled: true,
    },
    select: { id: true, name: true, suburb: true, clientId: true },
    orderBy: [{ name: "asc" }],
  });
}

async function assertPropertyAccess(scope: Scope, propertyId: string) {
  const properties = await accessibleProperties(scope);
  const property = properties.find((row) => row.id === propertyId);
  if (!property) {
    throw new Error("FORBIDDEN");
  }
  return property;
}

async function assertRunAccess(scope: Scope, runId: string) {
  const run = await db.stockRun.findUnique({
    where: { id: runId },
    include: {
      property: { select: { id: true, name: true, suburb: true, clientId: true } },
      requestedBy: { select: { id: true, name: true, email: true, role: true } },
      lines: {
        include: {
          propertyStock: {
            include: {
              item: true,
            },
          },
        },
        orderBy: [{ propertyStock: { item: { category: "asc" } } }, { propertyStock: { item: { name: "asc" } } }],
      },
    },
  });
  if (!run) throw new Error("NOT_FOUND");

  if (scope.role === "ADMIN" || scope.role === "OPS_MANAGER") return run;
  if (scope.role === "CLIENT" && run.property.clientId === scope.clientId) return run;
  if (
    scope.role === "CLEANER" &&
    (run.requestedByUserId === scope.userId || run.requestedByAdmin === true)
  ) {
    return run;
  }

  throw new Error("FORBIDDEN");
}

function serializeRun(run: Awaited<ReturnType<typeof assertRunAccess>>) {
  return {
    id: run.id,
    propertyId: run.propertyId,
    title: run.title,
    notes: run.notes,
    status: run.status,
    requestedByAdmin: run.requestedByAdmin,
    startedAt: run.startedAt,
    submittedAt: run.submittedAt,
    appliedAt: run.appliedAt,
    createdAt: run.createdAt,
    updatedAt: run.updatedAt,
    property: run.property,
    requestedBy: run.requestedBy,
    lines: run.lines.map((line) => ({
      id: line.id,
      propertyStockId: line.propertyStockId,
      expectedOnHand: line.expectedOnHand,
      countedOnHand: line.countedOnHand,
      parLevel: line.parLevel,
      reorderThreshold: line.reorderThreshold,
      note: line.note,
      item: line.propertyStock.item,
      currentOnHand: line.propertyStock.onHand,
      currentParLevel: line.propertyStock.parLevel,
      currentReorderThreshold: line.propertyStock.reorderThreshold,
    })),
  };
}

export async function listStockRuns(scope: Scope) {
  const properties = await accessibleProperties(scope);
  const propertyIds = properties.map((row) => row.id);
  const runs = await db.stockRun.findMany({
    where: {
      propertyId: { in: propertyIds.length > 0 ? propertyIds : ["__missing__"] },
      ...(scope.role === "CLEANER"
        ? {
            OR: [{ requestedByUserId: scope.userId }, { requestedByAdmin: true }],
          }
        : {}),
    },
    include: {
      property: { select: { id: true, name: true, suburb: true, clientId: true } },
      requestedBy: { select: { id: true, name: true, email: true, role: true } },
      _count: { select: { lines: true } },
    },
    orderBy: [{ updatedAt: "desc" }],
  });

  return {
    properties,
    canEditThresholds: canEditThresholds(scope),
    canApply: scope.role === "ADMIN" || scope.role === "OPS_MANAGER",
    runs,
  };
}

export async function getStockRun(scope: Scope, runId: string) {
  const run = await assertRunAccess(scope, runId);
  return {
    ...serializeRun(run),
    canEditThresholds: canEditThresholds(scope),
    canApply: scope.role === "ADMIN" || scope.role === "OPS_MANAGER",
  };
}

export async function createStockRun(
  scope: Scope,
  input: { propertyId: string; title?: string | null; notes?: string | null; requestedByAdmin?: boolean }
) {
  const property = await assertPropertyAccess(scope, input.propertyId);
  const stockRows = await db.propertyStock.findMany({
    where: { propertyId: input.propertyId },
    include: { item: true },
    orderBy: [{ item: { category: "asc" } }, { item: { name: "asc" } }],
  });
  if (stockRows.length === 0) {
    throw new Error("No inventory is configured for this property.");
  }

  const run = await db.stockRun.create({
    data: {
      propertyId: input.propertyId,
      requestedByUserId: scope.userId,
      requestedByAdmin: input.requestedByAdmin === true,
      title:
        input.title?.trim() ||
        `Stock Count - ${property.name} - ${new Date().toLocaleDateString("en-AU")}`,
      notes: input.notes?.trim() || null,
      status: StockRunStatus.ACTIVE,
      startedAt: new Date(),
      lines: {
        create: stockRows.map((row) => ({
          propertyStockId: row.id,
          expectedOnHand: row.onHand,
          countedOnHand: row.onHand,
          parLevel: row.parLevel,
          reorderThreshold: row.reorderThreshold,
        })),
      },
    },
  });

  return getStockRun(scope, run.id);
}

export async function updateStockRun(
  scope: Scope,
  runId: string,
  input: {
    title?: string | null;
    notes?: string | null;
    status?: StockRunStatus | null;
    lines?: StockRunLineInput[];
    apply?: boolean;
  }
) {
  const run = await assertRunAccess(scope, runId);
  const allowThresholds = canEditThresholds(scope);

  if (run.status === StockRunStatus.APPLIED) {
    throw new Error("Applied stock runs are read-only.");
  }

  if (Array.isArray(input.lines) && input.lines.length > 0) {
    await db.$transaction(
      input.lines.map((line) =>
        db.stockRunLine.update({
          where: { id: line.id },
          data: {
            countedOnHand:
              line.countedOnHand == null ? undefined : Math.max(0, Number(line.countedOnHand)),
            parLevel:
              allowThresholds && line.parLevel != null ? Math.max(0, Number(line.parLevel)) : undefined,
            reorderThreshold:
              allowThresholds && line.reorderThreshold != null
                ? Math.max(0, Number(line.reorderThreshold))
                : undefined,
            note: line.note?.trim() || null,
          },
        })
      )
    );
  }

  const nextStatus = input.apply
    ? StockRunStatus.APPLIED
    : input.status && Object.values(StockRunStatus).includes(input.status)
      ? input.status
      : undefined;

  if (nextStatus === StockRunStatus.APPLIED) {
    if (!(scope.role === "ADMIN" || scope.role === "OPS_MANAGER")) {
      throw new Error("FORBIDDEN");
    }

    const lines = await db.stockRunLine.findMany({
      where: { stockRunId: runId },
      include: { propertyStock: true },
    });

    await db.$transaction(async (tx) => {
      for (const line of lines) {
        const countedOnHand = Math.max(0, Number(line.countedOnHand ?? line.expectedOnHand));
        const delta = countedOnHand - Number(line.propertyStock.onHand);
        await tx.propertyStock.update({
          where: { id: line.propertyStockId },
          data: {
            onHand: countedOnHand,
            parLevel: line.parLevel ?? line.propertyStock.parLevel,
            reorderThreshold: line.reorderThreshold ?? line.propertyStock.reorderThreshold,
          },
        });
        if (delta !== 0) {
          await tx.stockTx.create({
            data: {
              propertyStockId: line.propertyStockId,
              txType: StockTxType.ADJUSTED,
              quantity: delta,
              notes: `Applied from stock run ${run.title}`,
            },
          });
        }
      }

      await tx.stockRun.update({
        where: { id: runId },
        data: {
          title: input.title?.trim() || undefined,
          notes: input.notes?.trim() || null,
          status: StockRunStatus.APPLIED,
          appliedAt: new Date(),
          submittedAt: run.submittedAt ?? new Date(),
        },
      });
    });
  } else {
    await db.stockRun.update({
      where: { id: runId },
      data: {
        title: input.title?.trim() || undefined,
        notes: input.notes?.trim() || null,
        status: nextStatus ?? undefined,
        startedAt: nextStatus === StockRunStatus.ACTIVE ? run.startedAt ?? new Date() : undefined,
        submittedAt: nextStatus === StockRunStatus.SUBMITTED ? new Date() : undefined,
      },
    });
  }

  return getStockRun(scope, runId);
}
