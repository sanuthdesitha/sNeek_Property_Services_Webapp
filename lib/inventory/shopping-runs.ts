import { randomUUID } from "crypto";
import { db } from "@/lib/db";

const SHOPPING_RUNS_KEY = "inventory_shopping_runs_v1";

export type ShoppingRunStatus = "DRAFT" | "IN_PROGRESS" | "COMPLETED";
export type ShoppingRunOwnerScope = "CLIENT" | "CLEANER";
export type ShoppingPaymentMethod =
  | "COMPANY_CARD"
  | "CLIENT_CARD"
  | "CLEANER_PERSONAL_CARD"
  | "ADMIN_PERSONAL_CARD"
  | "CASH"
  | "BANK_TRANSFER"
  | "OTHER";
export type ShoppingPaidByScope = "COMPANY" | "CLIENT" | "CLEANER" | "ADMIN" | "OTHER";
export type ShoppingRunClientChargeStatus = "NOT_REQUIRED" | "READY" | "SENT" | "PAID";
export type ShoppingRunCleanerReimbursementStatus =
  | "NOT_APPLICABLE"
  | "READY"
  | "INVOICED"
  | "REIMBURSED";

export type ShoppingRunAttachment = {
  key: string;
  url: string;
  name: string;
  mimeType?: string;
  sizeBytes?: number;
};

export type ShoppingRunPayment = {
  method: ShoppingPaymentMethod;
  paidByScope: ShoppingPaidByScope;
  paidByUserId?: string | null;
  paidByName?: string | null;
  note?: string;
  receipts: ShoppingRunAttachment[];
};

export type ShoppingRunRow = {
  propertyId: string;
  propertyName: string;
  suburb: string;
  itemId: string;
  itemName: string;
  category: string;
  supplier: string | null;
  unit: string;
  onHand: number;
  parLevel: number;
  reorderThreshold: number;
  needed: number;
  plannedQty: number;
  include: boolean;
  purchased: boolean;
  actualPurchasedQty: number;
  actualUnitCost?: number | null;
  actualLineCost?: number | null;
  checkedAt?: string;
  note?: string;
  priority?: "Emergency" | "High" | "Medium";
  estimatedUnitCost?: number | null;
  estimatedLineCost?: number | null;
};

export type ShoppingRunTotals = {
  lineCount: number;
  includedLineCount: number;
  purchasedLineCount: number;
  totalNeededUnits: number;
  plannedUnits: number;
  actualPurchasedUnits: number;
  estimatedTotalCost: number;
  actualTotalCost: number;
  reimbursableClientAmount: number;
  reimbursableCleanerAmount: number;
  byProperty: Array<{
    propertyId: string;
    propertyName: string;
    suburb: string;
    lineCount: number;
    plannedUnits: number;
    purchasedUnits: number;
    estimatedCost: number;
    actualCost: number;
    emergencyCount: number;
  }>;
  bySupplier: Array<{
    supplier: string;
    category: string;
    lineCount: number;
    plannedUnits: number;
    purchasedUnits: number;
    estimatedCost: number;
    actualCost: number;
  }>;
};

export type ShoppingRunRecord = {
  id: string;
  name: string;
  status: ShoppingRunStatus;
  ownerScope: ShoppingRunOwnerScope;
  ownerUserId: string;
  clientId?: string | null;
  planningScope: string; // "all" or propertyId
  rows: ShoppingRunRow[];
  payment: ShoppingRunPayment;
  totals: ShoppingRunTotals;
  startedAt?: string | null;
  completedAt?: string | null;
  clientChargeStatus: ShoppingRunClientChargeStatus;
  cleanerReimbursementStatus: ShoppingRunCleanerReimbursementStatus;
  clientChargeSentAt?: string | null;
  clientChargePaidAt?: string | null;
  cleanerReimbursementInvoicedAt?: string | null;
  cleanerReimbursementPaidAt?: string | null;
  reimbursementNote?: string;
  createdAt: string;
  updatedAt: string;
};

export type ShoppingRunClientAllocation = {
  clientId: string | null;
  clientName: string;
  clientEmail: string | null;
  propertyIds: string[];
  propertyNames: string[];
  lineCount: number;
  actualAmount: number;
  estimatedAmount: number;
  receiptCount: number;
  requiresClientCharge: boolean;
};

export type ShoppingRunAdminView = ShoppingRunRecord & {
  ownerName: string;
  ownerEmail: string;
  paidByDisplay: string;
  clientAllocations: ShoppingRunClientAllocation[];
};

type StoredData = {
  runs: ShoppingRunRecord[];
};

function toNumber(value: unknown, fallback = 0): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function trimText(value: unknown, max = 500) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function sanitizeStatus(value: unknown): ShoppingRunStatus {
  return value === "IN_PROGRESS" || value === "COMPLETED" ? value : "DRAFT";
}

function sanitizeOwnerScope(value: unknown): ShoppingRunOwnerScope {
  return value === "CLIENT" ? "CLIENT" : "CLEANER";
}

function sanitizePaymentMethod(value: unknown): ShoppingPaymentMethod {
  switch (value) {
    case "CLIENT_CARD":
    case "CLEANER_PERSONAL_CARD":
    case "ADMIN_PERSONAL_CARD":
    case "CASH":
    case "BANK_TRANSFER":
    case "OTHER":
      return value;
    default:
      return "COMPANY_CARD";
  }
}

function sanitizePaidByScope(value: unknown): ShoppingPaidByScope {
  switch (value) {
    case "CLIENT":
    case "CLEANER":
    case "ADMIN":
    case "OTHER":
      return value;
    default:
      return "COMPANY";
  }
}

function sanitizeClientChargeStatus(value: unknown): ShoppingRunClientChargeStatus {
  switch (value) {
    case "READY":
    case "SENT":
    case "PAID":
      return value;
    default:
      return "NOT_REQUIRED";
  }
}

function sanitizeCleanerReimbursementStatus(
  value: unknown
): ShoppingRunCleanerReimbursementStatus {
  switch (value) {
    case "READY":
    case "INVOICED":
    case "REIMBURSED":
      return value;
    default:
      return "NOT_APPLICABLE";
  }
}

function sanitizeAttachment(value: unknown): ShoppingRunAttachment | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  const key = String(row.key ?? "").trim();
  const url = String(row.url ?? "").trim();
  const name = String(row.name ?? "").trim() || "Receipt";
  if (!key || !url) return null;
  return {
    key,
    url,
    name: name.slice(0, 160),
    mimeType: trimText(row.mimeType, 120) || undefined,
    sizeBytes: row.sizeBytes == null ? undefined : Math.max(0, toNumber(row.sizeBytes, 0)),
  };
}

function sanitizePayment(
  value: unknown,
  fallbackOwnerScope?: ShoppingRunOwnerScope
): ShoppingRunPayment {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {
      method: fallbackOwnerScope === "CLIENT" ? "CLIENT_CARD" : "COMPANY_CARD",
      paidByScope: fallbackOwnerScope === "CLIENT" ? "CLIENT" : "COMPANY",
      receipts: [],
    };
  }
  const row = value as Record<string, unknown>;
  return {
    method: sanitizePaymentMethod(row.method),
    paidByScope: sanitizePaidByScope(row.paidByScope),
    paidByUserId: trimText(row.paidByUserId, 120) || null,
    paidByName: trimText(row.paidByName, 160) || null,
    note: trimText(row.note, 1000) || undefined,
    receipts: Array.isArray(row.receipts)
      ? (row.receipts.map(sanitizeAttachment).filter(Boolean) as ShoppingRunAttachment[])
      : [],
  };
}

function computeActualLineCost(
  row: Pick<ShoppingRunRow, "actualLineCost" | "actualPurchasedQty" | "actualUnitCost">
) {
  if (row.actualLineCost != null && Number.isFinite(Number(row.actualLineCost))) {
    return Math.max(0, Number(row.actualLineCost));
  }
  if (row.actualUnitCost != null && Number.isFinite(Number(row.actualUnitCost))) {
    return Math.max(0, Number(row.actualPurchasedQty)) * Math.max(0, Number(row.actualUnitCost));
  }
  return 0;
}

function requiresClientReimbursement(payment: ShoppingRunPayment, hasClient = true) {
  if (!hasClient) return false;
  return payment.paidByScope !== "CLIENT";
}

function requiresCleanerReimbursement(payment: ShoppingRunPayment) {
  return payment.paidByScope === "CLEANER";
}

function sanitizeRow(row: unknown): ShoppingRunRow | null {
  if (!row || typeof row !== "object" || Array.isArray(row)) return null;
  const r = row as Record<string, unknown>;
  const propertyId = String(r.propertyId ?? "").trim();
  const itemId = String(r.itemId ?? "").trim();
  const propertyName = String(r.propertyName ?? "").trim();
  const itemName = String(r.itemName ?? "").trim();
  if (!propertyId || !itemId || !propertyName || !itemName) return null;

  const priorityRaw = String(r.priority ?? "");
  const priority =
    priorityRaw === "Emergency" || priorityRaw === "High" || priorityRaw === "Medium"
      ? (priorityRaw as ShoppingRunRow["priority"])
      : undefined;

  const estimatedUnitCost = r.estimatedUnitCost == null ? null : toNumber(r.estimatedUnitCost, 0);
  const estimatedLineCost = r.estimatedLineCost == null ? null : toNumber(r.estimatedLineCost, 0);
  const actualUnitCost = r.actualUnitCost == null ? null : toNumber(r.actualUnitCost, 0);
  const actualLineCost = r.actualLineCost == null ? null : toNumber(r.actualLineCost, 0);
  const actualPurchasedQty = Math.max(
    0,
    toNumber(r.actualPurchasedQty, Boolean(r.purchased) ? toNumber(r.plannedQty, 0) : 0)
  );

  return {
    propertyId,
    propertyName,
    suburb: trimText(r.suburb, 160),
    itemId,
    itemName,
    category: trimText(r.category, 120) || "General",
    supplier: trimText(r.supplier, 160) || null,
    unit: trimText(r.unit, 60) || "unit",
    onHand: toNumber(r.onHand, 0),
    parLevel: toNumber(r.parLevel, 0),
    reorderThreshold: toNumber(r.reorderThreshold, 0),
    needed: Math.max(0, toNumber(r.needed, 0)),
    plannedQty: Math.max(0, toNumber(r.plannedQty, 0)),
    include: Boolean(r.include),
    purchased: Boolean(r.purchased),
    actualPurchasedQty,
    actualUnitCost: actualUnitCost == null ? null : Math.max(0, actualUnitCost),
    actualLineCost: actualLineCost == null ? null : Math.max(0, actualLineCost),
    checkedAt: trimText(r.checkedAt, 40) || undefined,
    note: trimText(r.note, 500) || undefined,
    priority,
    estimatedUnitCost: estimatedUnitCost == null ? null : Math.max(0, estimatedUnitCost),
    estimatedLineCost: estimatedLineCost == null ? null : Math.max(0, estimatedLineCost),
  };
}

function sanitizeTotals(
  value: unknown,
  rows: ShoppingRunRow[],
  payment: ShoppingRunPayment,
  hasClient: boolean
): ShoppingRunTotals {
  const fallback = computeShoppingRunTotals(rows, payment, hasClient);
  if (!value || typeof value !== "object" || Array.isArray(value)) return fallback;
  const v = value as Record<string, unknown>;
  return {
    lineCount: toNumber(v.lineCount, fallback.lineCount),
    includedLineCount: toNumber(v.includedLineCount, fallback.includedLineCount),
    purchasedLineCount: toNumber(v.purchasedLineCount, fallback.purchasedLineCount),
    totalNeededUnits: toNumber(v.totalNeededUnits, fallback.totalNeededUnits),
    plannedUnits: toNumber(v.plannedUnits, fallback.plannedUnits),
    actualPurchasedUnits: toNumber(v.actualPurchasedUnits, fallback.actualPurchasedUnits),
    estimatedTotalCost: toNumber(v.estimatedTotalCost, fallback.estimatedTotalCost),
    actualTotalCost: toNumber(v.actualTotalCost, fallback.actualTotalCost),
    reimbursableClientAmount: toNumber(
      v.reimbursableClientAmount,
      fallback.reimbursableClientAmount
    ),
    reimbursableCleanerAmount: toNumber(
      v.reimbursableCleanerAmount,
      fallback.reimbursableCleanerAmount
    ),
    byProperty: Array.isArray(v.byProperty)
      ? (v.byProperty as any[]).map((row) => ({
          propertyId: String(row?.propertyId ?? ""),
          propertyName: String(row?.propertyName ?? ""),
          suburb: String(row?.suburb ?? ""),
          lineCount: toNumber(row?.lineCount, 0),
          plannedUnits: toNumber(row?.plannedUnits, 0),
          purchasedUnits: toNumber(row?.purchasedUnits, 0),
          estimatedCost: toNumber(row?.estimatedCost, 0),
          actualCost: toNumber(row?.actualCost, 0),
          emergencyCount: toNumber(row?.emergencyCount, 0),
        })).filter((row) => row.propertyId && row.propertyName)
      : fallback.byProperty,
    bySupplier: Array.isArray(v.bySupplier)
      ? (v.bySupplier as any[]).map((row) => ({
          supplier: String(row?.supplier ?? "Unknown"),
          category: String(row?.category ?? "General"),
          lineCount: toNumber(row?.lineCount, 0),
          plannedUnits: toNumber(row?.plannedUnits, 0),
          estimatedCost: toNumber(row?.estimatedCost, 0),
          purchasedUnits: toNumber(row?.purchasedUnits, 0),
          actualCost: toNumber(row?.actualCost, 0),
        }))
      : fallback.bySupplier,
  };
}

function sanitizeRun(value: unknown): ShoppingRunRecord | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const v = value as Record<string, unknown>;
  const id = String(v.id ?? "").trim();
  const ownerUserId = String(v.ownerUserId ?? "").trim();
  if (!id || !ownerUserId) return null;
  const rows = Array.isArray(v.rows) ? v.rows.map(sanitizeRow).filter(Boolean) as ShoppingRunRow[] : [];
  const ownerScope = sanitizeOwnerScope(v.ownerScope);
  const payment = sanitizePayment(v.payment, ownerScope);
  const hasClient = String(v.clientId ?? "").trim().length > 0;
  return {
    id,
    name: trimText(v.name, 120) || "Shopping Run",
    status: sanitizeStatus(v.status),
    ownerScope,
    ownerUserId,
    clientId: trimText(v.clientId, 120) || null,
    planningScope: trimText(v.planningScope, 120) || "all",
    rows,
    payment,
    totals: sanitizeTotals(v.totals, rows, payment, hasClient),
    startedAt: trimText(v.startedAt, 40) || null,
    completedAt: trimText(v.completedAt, 40) || null,
    clientChargeStatus: sanitizeClientChargeStatus(v.clientChargeStatus),
    cleanerReimbursementStatus: sanitizeCleanerReimbursementStatus(
      v.cleanerReimbursementStatus
    ),
    clientChargeSentAt: trimText(v.clientChargeSentAt, 40) || null,
    clientChargePaidAt: trimText(v.clientChargePaidAt, 40) || null,
    cleanerReimbursementInvoicedAt:
      trimText(v.cleanerReimbursementInvoicedAt, 40) || null,
    cleanerReimbursementPaidAt: trimText(v.cleanerReimbursementPaidAt, 40) || null,
    reimbursementNote: trimText(v.reimbursementNote, 1000) || undefined,
    createdAt: typeof v.createdAt === "string" ? v.createdAt : new Date().toISOString(),
    updatedAt: typeof v.updatedAt === "string" ? v.updatedAt : new Date().toISOString(),
  };
}

async function readStore(): Promise<StoredData> {
  const row = await db.appSetting.findUnique({ where: { key: SHOPPING_RUNS_KEY } });
  const value = row?.value;
  if (!value || typeof value !== "object" || Array.isArray(value)) return { runs: [] };
  const runs = Array.isArray((value as any).runs)
    ? ((value as any).runs as unknown[]).map(sanitizeRun).filter(Boolean) as ShoppingRunRecord[]
    : [];
  return { runs };
}

async function writeStore(data: StoredData) {
  await db.appSetting.upsert({
    where: { key: SHOPPING_RUNS_KEY },
    create: { key: SHOPPING_RUNS_KEY, value: { runs: data.runs } as any },
    update: { value: { runs: data.runs } as any },
  });
}

export function computeShoppingRunTotals(
  rows: ShoppingRunRow[],
  payment?: ShoppingRunPayment,
  hasClient = true
): ShoppingRunTotals {
  const includedRows = rows.filter((row) => row.include);
  const byPropertyMap = new Map<string, ShoppingRunTotals["byProperty"][number]>();
  const bySupplierMap = new Map<string, ShoppingRunTotals["bySupplier"][number]>();
  let estimatedTotalCost = 0;
  let actualTotalCost = 0;

  for (const row of rows) {
    const lineEstimated =
      row.include && row.estimatedUnitCost != null ? row.plannedQty * Math.max(0, row.estimatedUnitCost) : 0;
    const lineActual = row.purchased ? computeActualLineCost(row) : 0;
    if (row.include) estimatedTotalCost += lineEstimated;
    if (row.purchased) actualTotalCost += lineActual;

    const propKey = row.propertyId;
    if (!byPropertyMap.has(propKey)) {
      byPropertyMap.set(propKey, {
        propertyId: row.propertyId,
        propertyName: row.propertyName,
        suburb: row.suburb,
        lineCount: 0,
        plannedUnits: 0,
        purchasedUnits: 0,
        estimatedCost: 0,
        actualCost: 0,
        emergencyCount: 0,
      });
    }
    const prop = byPropertyMap.get(propKey)!;
    prop.lineCount += 1;
    if (row.include) {
      prop.plannedUnits += row.plannedQty;
      prop.estimatedCost += lineEstimated;
    }
    if (row.purchased) {
      prop.purchasedUnits += row.actualPurchasedQty;
      prop.actualCost += lineActual;
    }
    if (row.priority === "Emergency") prop.emergencyCount += 1;

    const supplierKey = `${row.category}||${row.supplier ?? "Unknown"}`;
    if (!bySupplierMap.has(supplierKey)) {
      bySupplierMap.set(supplierKey, {
        supplier: row.supplier ?? "Unknown",
        category: row.category,
        lineCount: 0,
        plannedUnits: 0,
        purchasedUnits: 0,
        estimatedCost: 0,
        actualCost: 0,
      });
    }
    const sup = bySupplierMap.get(supplierKey)!;
    sup.lineCount += 1;
    if (row.include) {
      sup.plannedUnits += row.plannedQty;
      sup.estimatedCost += lineEstimated;
    }
    if (row.purchased) {
      sup.purchasedUnits += row.actualPurchasedQty;
      sup.actualCost += lineActual;
    }
  }

  return {
    lineCount: rows.length,
    includedLineCount: includedRows.length,
    purchasedLineCount: rows.filter((row) => row.purchased).length,
    totalNeededUnits: rows.reduce((sum, row) => sum + Math.max(0, row.needed), 0),
    plannedUnits: includedRows.reduce((sum, row) => sum + Math.max(0, row.plannedQty), 0),
    actualPurchasedUnits: rows.reduce(
      (sum, row) => sum + (row.purchased ? Math.max(0, row.actualPurchasedQty) : 0),
      0
    ),
    estimatedTotalCost,
    actualTotalCost,
    reimbursableClientAmount:
      payment && requiresClientReimbursement(payment, hasClient) ? actualTotalCost : 0,
    reimbursableCleanerAmount:
      payment && requiresCleanerReimbursement(payment) ? actualTotalCost : 0,
    byProperty: Array.from(byPropertyMap.values()).sort((a, b) => a.propertyName.localeCompare(b.propertyName)),
    bySupplier: Array.from(bySupplierMap.values()).sort((a, b) => {
      if (a.category !== b.category) return a.category.localeCompare(b.category);
      return a.supplier.localeCompare(b.supplier);
    }),
  };
}

export async function listShoppingRunsForOwner(input: {
  ownerScope: ShoppingRunOwnerScope;
  ownerUserId: string;
  clientId?: string | null;
}) {
  const store = await readStore();
  return store.runs
    .filter((run) => {
      if (run.ownerScope !== input.ownerScope) return false;
      if (run.ownerScope === "CLIENT") {
        return run.clientId && input.clientId && run.clientId === input.clientId;
      }
      return run.ownerUserId === input.ownerUserId;
    })
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function listShoppingRunsForAdmin() {
  const store = await readStore();
  return store.runs.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function getShoppingRunForOwner(input: {
  id: string;
  ownerScope: ShoppingRunOwnerScope;
  ownerUserId: string;
  clientId?: string | null;
}) {
  const runs = await listShoppingRunsForOwner(input);
  return runs.find((run) => run.id === input.id) ?? null;
}

export async function getShoppingRunByIdForAdmin(id: string) {
  const runs = await listShoppingRunsForAdmin();
  return runs.find((run) => run.id === id) ?? null;
}

export async function listShoppingRunsForAdminDetailed(): Promise<ShoppingRunAdminView[]> {
  const runs = await listShoppingRunsForAdmin();
  if (runs.length === 0) return [];

  const [owners, properties] = await Promise.all([
    db.user.findMany({
      where: { id: { in: Array.from(new Set(runs.map((run) => run.ownerUserId))) } },
      select: { id: true, name: true, email: true },
    }),
    db.property.findMany({
      where: {
        id: {
          in: Array.from(new Set(runs.flatMap((run) => run.rows.map((row) => row.propertyId)))),
        },
      },
      select: {
        id: true,
        name: true,
        client: { select: { id: true, name: true, email: true } },
      },
    }),
  ]);

  const ownerMap = new Map(
    owners.map((owner) => [owner.id, { name: owner.name?.trim() || owner.email, email: owner.email }])
  );
  const propertyMap = new Map(properties.map((property) => [property.id, property]));

  return runs.map((run) => {
    const allocations = new Map<string, ShoppingRunClientAllocation>();
    for (const row of run.rows) {
      const property = propertyMap.get(row.propertyId);
      const clientId = property?.client?.id ?? run.clientId ?? null;
      const clientName = property?.client?.name ?? "Unassigned client";
      const key = clientId ?? `unassigned:${row.propertyId}`;
      if (!allocations.has(key)) {
        allocations.set(key, {
          clientId,
          clientName,
          clientEmail: property?.client?.email ?? null,
          propertyIds: [],
          propertyNames: [],
          lineCount: 0,
          actualAmount: 0,
          estimatedAmount: 0,
          receiptCount: run.payment.receipts.length,
          requiresClientCharge:
            run.clientChargeStatus !== "NOT_REQUIRED" &&
            requiresClientReimbursement(run.payment, Boolean(clientId)),
        });
      }
      const allocation = allocations.get(key)!;
      allocation.lineCount += 1;
      if (!allocation.propertyIds.includes(row.propertyId)) {
        allocation.propertyIds.push(row.propertyId);
        allocation.propertyNames.push(property?.name ?? row.propertyName);
      }
      if (row.include) {
        allocation.estimatedAmount +=
          row.estimatedUnitCost != null
            ? row.plannedQty * row.estimatedUnitCost
            : Math.max(0, Number(row.estimatedLineCost ?? 0));
      }
      if (row.purchased) {
        allocation.actualAmount += computeActualLineCost(row);
      }
    }

    const owner = ownerMap.get(run.ownerUserId);
    return {
      ...run,
      ownerName: owner?.name ?? "Unknown user",
      ownerEmail: owner?.email ?? "",
      paidByDisplay:
        run.payment.paidByName?.trim() ||
        run.payment.paidByUserId?.trim() ||
        run.payment.paidByScope.replace(/_/g, " "),
      clientAllocations: Array.from(allocations.values()).sort((a, b) =>
        a.clientName.localeCompare(b.clientName)
      ),
    };
  });
}

export async function getShoppingRunBillingContextById(id: string) {
  const runs = await listShoppingRunsForAdminDetailed();
  return runs.find((run) => run.id === id) ?? null;
}

export async function listCleanerReimbursableShoppingRuns(input: {
  cleanerId: string;
  start: Date;
  end: Date;
}) {
  const runs = await listShoppingRunsForAdmin();
  return runs.filter((run) => {
    if (run.ownerScope !== "CLEANER") return false;
    if (run.payment.paidByScope !== "CLEANER") return false;
    if (run.payment.paidByUserId && run.payment.paidByUserId !== input.cleanerId) return false;
    if (run.cleanerReimbursementStatus !== "READY") return false;
    if (run.totals.actualTotalCost <= 0) return false;
    const effectiveDate = run.completedAt || run.updatedAt || run.createdAt;
    const when = new Date(effectiveDate);
    return when >= input.start && when <= input.end;
  });
}

export async function saveShoppingRunForOwner(input: {
  id?: string;
  name: string;
  status: ShoppingRunStatus;
  ownerScope: ShoppingRunOwnerScope;
  ownerUserId: string;
  clientId?: string | null;
  planningScope: string;
  rows: ShoppingRunRow[];
  payment?: Partial<ShoppingRunPayment>;
  startedAt?: string | null;
  completedAt?: string | null;
  reimbursementNote?: string;
}) {
  const store = await readStore();
  const now = new Date().toISOString();

  const existingIndex = input.id ? store.runs.findIndex((run) => run.id === input.id) : -1;
  if (existingIndex >= 0) {
    const existing = store.runs[existingIndex];
    if (existing.ownerScope !== input.ownerScope) throw new Error("FORBIDDEN");
    if (input.ownerScope === "CLIENT") {
      if (!existing.clientId || existing.clientId !== (input.clientId ?? null)) throw new Error("FORBIDDEN");
    } else if (existing.ownerUserId !== input.ownerUserId) {
      throw new Error("FORBIDDEN");
    }
    store.runs[existingIndex] = {
      ...existing,
      name: input.name,
      status: input.status,
      planningScope: input.planningScope || "all",
      rows: input.rows,
      payment: sanitizePayment(
        {
          ...existing.payment,
          ...(input.payment ?? {}),
          receipts: input.payment?.receipts ?? existing.payment.receipts,
        },
        input.ownerScope
      ),
      totals: computeShoppingRunTotals(
        input.rows,
        sanitizePayment(
          {
            ...existing.payment,
            ...(input.payment ?? {}),
            receipts: input.payment?.receipts ?? existing.payment.receipts,
          },
          input.ownerScope
        ),
        Boolean(existing.clientId ?? input.clientId)
      ),
      startedAt:
        input.startedAt !== undefined
          ? input.startedAt
          : existing.startedAt || (input.status !== "DRAFT" ? now : null),
      completedAt:
        input.completedAt !== undefined
          ? input.completedAt
          : input.status === "COMPLETED"
            ? existing.completedAt || now
            : null,
      clientChargeStatus:
        existing.clientChargeStatus === "PAID" || existing.clientChargeStatus === "SENT"
          ? existing.clientChargeStatus
          : (computeShoppingRunTotals(
              input.rows,
              sanitizePayment(
                {
                  ...existing.payment,
                  ...(input.payment ?? {}),
                  receipts: input.payment?.receipts ?? existing.payment.receipts,
                },
                input.ownerScope
              ),
              Boolean(existing.clientId ?? input.clientId)
            ).actualTotalCost > 0 &&
            requiresClientReimbursement(
              sanitizePayment(
                {
                  ...existing.payment,
                  ...(input.payment ?? {}),
                  receipts: input.payment?.receipts ?? existing.payment.receipts,
                },
                input.ownerScope
              ),
              Boolean(existing.clientId ?? input.clientId)
            ))
            ? "READY"
            : "NOT_REQUIRED",
      cleanerReimbursementStatus:
        existing.cleanerReimbursementStatus === "INVOICED" ||
        existing.cleanerReimbursementStatus === "REIMBURSED"
          ? existing.cleanerReimbursementStatus
          : (computeShoppingRunTotals(
              input.rows,
              sanitizePayment(
                {
                  ...existing.payment,
                  ...(input.payment ?? {}),
                  receipts: input.payment?.receipts ?? existing.payment.receipts,
                },
                input.ownerScope
              ),
              Boolean(existing.clientId ?? input.clientId)
            ).actualTotalCost > 0 &&
            requiresCleanerReimbursement(
              sanitizePayment(
                {
                  ...existing.payment,
                  ...(input.payment ?? {}),
                  receipts: input.payment?.receipts ?? existing.payment.receipts,
                },
                input.ownerScope
              )
            ))
            ? "READY"
            : "NOT_APPLICABLE",
      reimbursementNote: input.reimbursementNote ?? existing.reimbursementNote,
      updatedAt: now,
    };
    await writeStore(store);
    return store.runs[existingIndex];
  }

  const payment = sanitizePayment(input.payment, input.ownerScope);
  const totals = computeShoppingRunTotals(input.rows, payment, Boolean(input.clientId));
  const created: ShoppingRunRecord = {
    id: randomUUID(),
    name: input.name,
    status: input.status,
    ownerScope: input.ownerScope,
    ownerUserId: input.ownerUserId,
    clientId: input.clientId ?? null,
    planningScope: input.planningScope || "all",
    rows: input.rows,
    payment,
    totals,
    startedAt: input.startedAt ?? (input.status !== "DRAFT" ? now : null),
    completedAt: input.completedAt ?? (input.status === "COMPLETED" ? now : null),
    clientChargeStatus:
      totals.actualTotalCost > 0 && requiresClientReimbursement(payment, Boolean(input.clientId))
        ? "READY"
        : "NOT_REQUIRED",
    cleanerReimbursementStatus:
      totals.actualTotalCost > 0 && requiresCleanerReimbursement(payment)
        ? "READY"
        : "NOT_APPLICABLE",
    clientChargeSentAt: null,
    clientChargePaidAt: null,
    cleanerReimbursementInvoicedAt: null,
    cleanerReimbursementPaidAt: null,
    reimbursementNote: input.reimbursementNote,
    createdAt: now,
    updatedAt: now,
  };
  store.runs.unshift(created);
  // Keep bounded to avoid unbounded AppSetting growth.
  if (store.runs.length > 500) store.runs = store.runs.slice(0, 500);
  await writeStore(store);
  return created;
}

export async function deleteShoppingRunForOwner(input: {
  id: string;
  ownerScope: ShoppingRunOwnerScope;
  ownerUserId: string;
  clientId?: string | null;
}) {
  const store = await readStore();
  const before = store.runs.length;
  store.runs = store.runs.filter((run) => {
    if (run.id !== input.id) return true;
    if (run.ownerScope !== input.ownerScope) return true;
    if (input.ownerScope === "CLIENT") {
      return !(run.clientId && input.clientId && run.clientId === input.clientId);
    }
    return run.ownerUserId !== input.ownerUserId;
  });
  if (store.runs.length === before) return false;
  await writeStore(store);
  return true;
}

export async function updateShoppingRunByAdmin(input: {
  id: string;
  status?: ShoppingRunStatus;
  payment?: Partial<ShoppingRunPayment>;
  clientChargeStatus?: ShoppingRunClientChargeStatus;
  cleanerReimbursementStatus?: ShoppingRunCleanerReimbursementStatus;
  clientChargeSentAt?: string | null;
  clientChargePaidAt?: string | null;
  cleanerReimbursementInvoicedAt?: string | null;
  cleanerReimbursementPaidAt?: string | null;
  reimbursementNote?: string | null;
}) {
  const store = await readStore();
  const index = store.runs.findIndex((run) => run.id === input.id);
  if (index < 0) throw new Error("NOT_FOUND");
  const existing = store.runs[index];
  const payment = sanitizePayment(
    {
      ...existing.payment,
      ...(input.payment ?? {}),
      receipts: input.payment?.receipts ?? existing.payment.receipts,
    },
    existing.ownerScope
  );
  const totals = computeShoppingRunTotals(existing.rows, payment, Boolean(existing.clientId));
  store.runs[index] = {
    ...existing,
    status: input.status ?? existing.status,
    payment,
    totals,
    clientChargeStatus:
      input.clientChargeStatus ?? existing.clientChargeStatus,
    cleanerReimbursementStatus:
      input.cleanerReimbursementStatus ?? existing.cleanerReimbursementStatus,
    clientChargeSentAt:
      input.clientChargeSentAt !== undefined
        ? input.clientChargeSentAt
        : existing.clientChargeSentAt,
    clientChargePaidAt:
      input.clientChargePaidAt !== undefined
        ? input.clientChargePaidAt
        : existing.clientChargePaidAt,
    cleanerReimbursementInvoicedAt:
      input.cleanerReimbursementInvoicedAt !== undefined
        ? input.cleanerReimbursementInvoicedAt
        : existing.cleanerReimbursementInvoicedAt,
    cleanerReimbursementPaidAt:
      input.cleanerReimbursementPaidAt !== undefined
        ? input.cleanerReimbursementPaidAt
        : existing.cleanerReimbursementPaidAt,
    reimbursementNote:
      input.reimbursementNote === null
        ? undefined
        : input.reimbursementNote ?? existing.reimbursementNote,
    updatedAt: new Date().toISOString(),
  };
  await writeStore(store);
  return store.runs[index];
}

export async function markCleanerShoppingRunsInvoiced(input: {
  cleanerId: string;
  runIds: string[];
}) {
  if (input.runIds.length === 0) return;
  const store = await readStore();
  let changed = false;
  const now = new Date().toISOString();
  store.runs = store.runs.map((run) => {
    if (!input.runIds.includes(run.id)) return run;
    if (run.payment.paidByScope !== "CLEANER") return run;
    if (run.payment.paidByUserId && run.payment.paidByUserId !== input.cleanerId) return run;
    changed = true;
    return {
      ...run,
      cleanerReimbursementStatus: "INVOICED",
      cleanerReimbursementInvoicedAt: now,
      updatedAt: now,
    };
  });
  if (changed) {
    await writeStore(store);
  }
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

export function formatShoppingPaymentMethod(method: ShoppingPaymentMethod) {
  switch (method) {
    case "COMPANY_CARD":
      return "Company card";
    case "CLIENT_CARD":
      return "Client card";
    case "CLEANER_PERSONAL_CARD":
      return "Cleaner personal card";
    case "ADMIN_PERSONAL_CARD":
      return "Admin personal card";
    case "BANK_TRANSFER":
      return "Bank transfer";
    case "CASH":
      return "Cash";
    default:
      return "Other";
  }
}

export function buildShoppingRunHtml(input: {
  companyName: string;
  logoUrl?: string;
  title?: string;
  run: ShoppingRunRecord;
}) {
  const logoUrl = input.logoUrl?.trim() || "";
  const totals = input.run.totals;
  const payment = input.run.payment;
  const rowsByProperty = totals.byProperty;
  const rowsHtml = rowsByProperty
    .map((prop) => {
      const lines = input.run.rows.filter((row) => row.propertyId === prop.propertyId);
      return `
        <section class="prop">
          <div class="prop-head">
            <h3>${escapeHtml(prop.propertyName)} <span>(${escapeHtml(prop.suburb)})</span></h3>
            <div class="prop-meta">
              <span>${prop.lineCount} lines</span>
              <span>${prop.plannedUnits} planned units</span>
              <span>${prop.purchasedUnits} purchased units</span>
              <span>Actual ${prop.actualCost.toFixed(2)}</span>
            </div>
          </div>
          <table>
            <thead>
              <tr>
                <th>Buy</th>
                <th>Item</th>
                <th>Supplier</th>
                <th>Plan</th>
                <th>Got</th>
                <th>Purchased</th>
                <th>Actual Cost</th>
                <th>Notes</th>
              </tr>
            </thead>
            <tbody>
              ${lines
                .map((line) => {
                  const actual = line.purchased ? computeActualLineCost(line) : 0;
                  return `
                    <tr>
                      <td>${line.include ? "[x]" : "[ ]"}</td>
                      <td>${escapeHtml(line.itemName)}<div class="sub">${escapeHtml(line.category)}</div></td>
                      <td>${escapeHtml(line.supplier ?? "Unknown")}</td>
                      <td class="right">${line.include ? line.plannedQty : 0} ${escapeHtml(line.unit)}</td>
                      <td class="right">${line.purchased ? line.actualPurchasedQty : 0} ${escapeHtml(line.unit)}</td>
                      <td>${line.purchased ? "Yes" : "No"}</td>
                      <td class="right">${line.purchased ? `${actual.toFixed(2)}` : "-"}</td>
                      <td>${escapeHtml(line.note ?? "")}</td>
                    </tr>
                  `;
                })
                .join("")}
            </tbody>
          </table>
        </section>
      `;
    })
    .join("");

  return `<!doctype html>
  <html>
    <head>
      <meta charset="utf-8" />
      <title>${escapeHtml(input.run.name)}</title>
      <style>
        body { font-family: Arial, sans-serif; color:#111827; margin:18px; }
        .brand { display:flex; align-items:center; gap:12px; }
        .brand img { width:42px; height:42px; object-fit:contain; border:1px solid #e5e7eb; border-radius:8px; padding:3px; background:#fff; }
        h1 { margin:0; font-size:22px; }
        .muted { color:#6b7280; font-size:12px; margin-top:3px; }
        .chips { margin-top:10px; display:flex; gap:8px; flex-wrap:wrap; }
        .chip { border:1px solid #d1d5db; border-radius:999px; padding:4px 8px; font-size:11px; }
        .summary { margin-top:12px; display:grid; grid-template-columns: repeat(4,1fr); gap:8px; }
        .tile { border:1px solid #e5e7eb; border-radius:8px; padding:8px; }
        .tile .label { color:#6b7280; font-size:10px; text-transform:uppercase; }
        .tile .value { font-weight:700; font-size:16px; margin-top:2px; }
        .prop { margin-top:16px; }
        .prop-head { display:flex; justify-content:space-between; align-items:flex-start; gap:10px; margin-bottom:6px; }
        .prop-head h3 { margin:0; font-size:14px; }
        .prop-head h3 span { color:#6b7280; font-weight:400; font-size:12px; }
        .prop-meta { display:flex; gap:10px; flex-wrap:wrap; color:#6b7280; font-size:11px; }
        table { width:100%; border-collapse:collapse; font-size:11px; }
        th, td { border-bottom:1px solid #e5e7eb; padding:5px; vertical-align:top; }
        th { background:#f9fafb; text-align:left; }
        .right { text-align:right; white-space:nowrap; }
        .sub { color:#6b7280; font-size:10px; margin-top:2px; }
      </style>
    </head>
    <body>
      <div class="brand">
        ${logoUrl ? `<img src="${escapeHtml(logoUrl)}" alt="${escapeHtml(input.companyName)} logo" />` : ""}
        <div>
          <h1>${escapeHtml(input.title ?? "Shopping Run")} - ${escapeHtml(input.run.name)}</h1>
          <div class="muted">${escapeHtml(input.companyName)}</div>
          <div class="muted">Created ${new Date(input.run.createdAt).toLocaleString("en-AU")} | Updated ${new Date(input.run.updatedAt).toLocaleString("en-AU")}</div>
        </div>
      </div>
      <div class="chips">
        <span class="chip">Status: ${escapeHtml(input.run.status.replace("_", " "))}</span>
        <span class="chip">Scope: ${escapeHtml(input.run.planningScope)}</span>
        <span class="chip">Payment: ${escapeHtml(formatShoppingPaymentMethod(payment.method))}</span>
        <span class="chip">Paid by: ${escapeHtml(payment.paidByName?.trim() || payment.paidByScope)}</span>
        <span class="chip">Actual Total: ${totals.actualTotalCost.toFixed(2)}</span>
        <span class="chip">Receipts: ${payment.receipts.length}</span>
      </div>
      <div class="summary">
        <div class="tile"><div class="label">Lines</div><div class="value">${totals.lineCount}</div></div>
        <div class="tile"><div class="label">Included</div><div class="value">${totals.includedLineCount}</div></div>
        <div class="tile"><div class="label">Purchased</div><div class="value">${totals.purchasedLineCount}</div></div>
        <div class="tile"><div class="label">Actual Cost</div><div class="value">${totals.actualTotalCost.toFixed(2)}</div></div>
      </div>
      ${rowsHtml}
    </body>
  </html>`;
}

export function buildShoppingRunPurchaseOrderHtml(input: {
  companyName: string;
  logoUrl?: string;
  run: ShoppingRunRecord;
  supplier?: string;
  orderReference?: string;
}) {
  const logoUrl = input.logoUrl?.trim() || "";
  const supplierFilter = input.supplier?.trim();
  const filteredRows = input.run.rows.filter((row) => {
    if (!row.include) return false;
    if (!supplierFilter) return true;
    return (row.supplier ?? "Unknown") === supplierFilter;
  });
  const grouped = filteredRows.reduce<
    Record<
      string,
      {
        supplier: string;
        lines: ShoppingRunRow[];
      }
    >
  >((acc, row) => {
    const supplier = row.supplier ?? "Unknown";
    if (!acc[supplier]) acc[supplier] = { supplier, lines: [] };
    acc[supplier].lines.push(row);
    return acc;
  }, {});
  const suppliers = Object.values(grouped).sort((a, b) => a.supplier.localeCompare(b.supplier));

  const sections = suppliers
    .map((group) => {
      const total = group.lines.reduce((sum, row) => {
        if (row.estimatedUnitCost == null) return sum;
        return sum + row.plannedQty * row.estimatedUnitCost;
      }, 0);
      return `
        <section class="supplier">
          <div class="supplier-head">
            <h2>${escapeHtml(group.supplier)}</h2>
            <div class="meta">Lines: ${group.lines.length} | Est. Total: $${total.toFixed(2)}</div>
          </div>
          <table>
            <thead>
              <tr>
                <th>Item</th>
                <th>Category</th>
                <th>Property</th>
                <th>Qty</th>
                <th>Unit</th>
                <th>Unit Cost</th>
                <th>Est. Total</th>
                <th>Priority</th>
                <th>Note</th>
              </tr>
            </thead>
            <tbody>
              ${group.lines
                .map((row) => {
                  const est =
                    row.estimatedUnitCost == null ? null : row.plannedQty * row.estimatedUnitCost;
                  return `
                    <tr>
                      <td>${escapeHtml(row.itemName)}</td>
                      <td>${escapeHtml(row.category)}</td>
                      <td>${escapeHtml(row.propertyName)}<div class="sub">${escapeHtml(row.suburb)}</div></td>
                      <td class="right">${row.plannedQty}</td>
                      <td>${escapeHtml(row.unit)}</td>
                      <td class="right">${row.estimatedUnitCost != null ? `$${row.estimatedUnitCost.toFixed(2)}` : "-"}</td>
                      <td class="right">${est != null ? `$${est.toFixed(2)}` : "-"}</td>
                      <td>${escapeHtml(row.priority ?? "-")}</td>
                      <td>${escapeHtml(row.note ?? "")}</td>
                    </tr>
                  `;
                })
                .join("")}
            </tbody>
          </table>
        </section>
      `;
    })
    .join("");

  const totalEstimated = filteredRows.reduce((sum, row) => {
    if (row.estimatedUnitCost == null) return sum;
    return sum + row.plannedQty * row.estimatedUnitCost;
  }, 0);

  return `<!doctype html>
  <html>
    <head>
      <meta charset="utf-8" />
      <title>Purchase Order - ${escapeHtml(input.run.name)}</title>
      <style>
        body { font-family: Arial, sans-serif; color:#111827; margin:18px; }
        .brand { display:flex; align-items:center; gap:12px; }
        .brand img { width:42px; height:42px; object-fit:contain; border:1px solid #e5e7eb; border-radius:8px; padding:3px; background:#fff; }
        h1 { margin:0; font-size:22px; }
        .muted { color:#6b7280; font-size:12px; margin-top:3px; }
        .chips { margin-top:10px; display:flex; gap:8px; flex-wrap:wrap; }
        .chip { border:1px solid #d1d5db; border-radius:999px; padding:4px 8px; font-size:11px; }
        .supplier { margin-top:18px; }
        .supplier-head { display:flex; justify-content:space-between; align-items:flex-end; margin-bottom:6px; }
        .supplier-head h2 { margin:0; font-size:16px; }
        .meta { font-size:11px; color:#6b7280; }
        table { width:100%; border-collapse:collapse; font-size:11px; }
        th, td { border-bottom:1px solid #e5e7eb; padding:5px; vertical-align:top; text-align:left; }
        th { background:#f9fafb; }
        .right { text-align:right; white-space:nowrap; }
        .sub { color:#6b7280; font-size:10px; margin-top:2px; }
      </style>
    </head>
    <body>
      <div class="brand">
        ${logoUrl ? `<img src="${escapeHtml(logoUrl)}" alt="${escapeHtml(input.companyName)} logo" />` : ""}
        <div>
          <h1>Purchase Order - ${escapeHtml(input.run.name)}</h1>
          <div class="muted">${escapeHtml(input.companyName)}</div>
          <div class="muted">Created ${new Date(input.run.createdAt).toLocaleString("en-AU")} | Updated ${new Date(input.run.updatedAt).toLocaleString("en-AU")}</div>
        </div>
      </div>
      <div class="chips">
        <span class="chip">Status: ${escapeHtml(input.run.status.replace("_", " "))}</span>
        <span class="chip">Scope: ${escapeHtml(input.run.planningScope)}</span>
        <span class="chip">Supplier: ${escapeHtml(supplierFilter ?? "All")}</span>
        <span class="chip">Reference: ${escapeHtml(input.orderReference?.trim() || `PO-${input.run.id.slice(0, 8)}`)}</span>
        <span class="chip">Est. Total: $${totalEstimated.toFixed(2)}</span>
      </div>
      ${sections || `<p class="muted" style="margin-top:18px;">No included lines found for this supplier scope.</p>`}
    </body>
  </html>`;
}

export function buildShoppingRunClientReimbursementHtml(input: {
  companyName: string;
  logoUrl?: string;
  run: ShoppingRunAdminView;
  clientAllocation: ShoppingRunClientAllocation;
}) {
  const rows = input.run.rows.filter((row) =>
    input.clientAllocation.propertyIds.includes(row.propertyId)
  );
  const rowsHtml = rows
    .map((row) => {
      const actual = row.purchased ? computeActualLineCost(row) : 0;
      return `
        <tr>
          <td>${escapeHtml(row.propertyName)}</td>
          <td>${escapeHtml(row.itemName)}</td>
          <td>${row.purchased ? row.actualPurchasedQty : 0}</td>
          <td>${escapeHtml(row.unit)}</td>
          <td>${row.purchased ? `$${actual.toFixed(2)}` : "-"}</td>
          <td>${escapeHtml(row.note ?? "")}</td>
        </tr>
      `;
    })
    .join("");

  return `<!doctype html>
  <html>
    <head>
      <meta charset="utf-8" />
      <title>Client Reimbursement - ${escapeHtml(input.run.name)}</title>
      <style>
        body { font-family: Arial, sans-serif; color:#111827; margin:20px; }
        .brand { display:flex; gap:12px; align-items:center; }
        .brand img { width:46px; height:46px; object-fit:contain; border:1px solid #e5e7eb; border-radius:8px; padding:4px; }
        h1 { margin:0; font-size:22px; }
        .muted { color:#6b7280; font-size:12px; }
        .summary { display:grid; grid-template-columns: repeat(4,1fr); gap:10px; margin-top:16px; }
        .tile { border:1px solid #e5e7eb; border-radius:8px; padding:10px; }
        .tile .label { color:#6b7280; font-size:10px; text-transform:uppercase; }
        .tile .value { font-size:16px; font-weight:700; margin-top:4px; }
        table { width:100%; border-collapse:collapse; margin-top:18px; font-size:12px; }
        th, td { border-bottom:1px solid #e5e7eb; padding:7px; text-align:left; vertical-align:top; }
        th { background:#f9fafb; }
      </style>
    </head>
    <body>
      <div class="brand">
        ${input.logoUrl ? `<img src="${escapeHtml(input.logoUrl)}" alt="${escapeHtml(input.companyName)} logo" />` : ""}
        <div>
          <h1>Shopping Reimbursement Summary</h1>
          <div class="muted">${escapeHtml(input.companyName)}</div>
          <div class="muted">Run ${escapeHtml(input.run.name)} | Client ${escapeHtml(input.clientAllocation.clientName)}</div>
        </div>
      </div>
      <div class="summary">
        <div class="tile"><div class="label">Client</div><div class="value">${escapeHtml(input.clientAllocation.clientName)}</div></div>
        <div class="tile"><div class="label">Run Total</div><div class="value">$${input.clientAllocation.actualAmount.toFixed(2)}</div></div>
        <div class="tile"><div class="label">Receipt Count</div><div class="value">${input.run.payment.receipts.length}</div></div>
        <div class="tile"><div class="label">Paid By</div><div class="value">${escapeHtml(formatShoppingPaymentMethod(input.run.payment.method))}</div></div>
      </div>
      <p class="muted" style="margin-top:14px;">Only lines for the selected client are included below. Receipts are provided separately as attachments or direct download links.</p>
      <table>
        <thead>
          <tr>
            <th>Property</th>
            <th>Item</th>
            <th>Qty</th>
            <th>Unit</th>
            <th>Actual Cost</th>
            <th>Note</th>
          </tr>
        </thead>
        <tbody>${rowsHtml}</tbody>
      </table>
    </body>
  </html>`;
}

export async function renderShoppingRunPdf(html: string): Promise<Buffer> {
  const { chromium } = await import("playwright");
  const launchers = [undefined, { channel: "msedge" as const }, { channel: "chrome" as const }];
  let lastErr: unknown;
  for (const opts of launchers) {
    let browser: any;
    try {
      browser = await chromium.launch(opts ? opts : undefined);
      const page = await browser.newPage();
      await page.setContent(html, { waitUntil: "networkidle" });
      const pdf = await page.pdf({
        format: "A4",
        printBackground: true,
        margin: { top: "10mm", right: "8mm", bottom: "10mm", left: "8mm" },
      });
      return Buffer.from(pdf);
    } catch (err) {
      lastErr = err;
    } finally {
      try {
        await browser?.close();
      } catch {}
    }
  }
  throw lastErr ?? new Error("PDF generation failed");
}

