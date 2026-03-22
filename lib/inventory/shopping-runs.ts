import { randomUUID } from "crypto";
import {
  Role,
  ShoppingPaidByScope as PrismaShoppingPaidByScope,
  ShoppingPaymentMethod as PrismaShoppingPaymentMethod,
  ShoppingRunStatus as PrismaShoppingRunStatus,
} from "@prisma/client";
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

type ShoppingRunCompatData = {
  ownerScope?: ShoppingRunOwnerScope | "ADMIN";
  planningScope?: string;
  clientChargeStatus?: ShoppingRunClientChargeStatus;
  cleanerReimbursementStatus?: ShoppingRunCleanerReimbursementStatus;
  clientChargeSentAt?: string | null;
  clientChargePaidAt?: string | null;
  cleanerReimbursementInvoicedAt?: string | null;
  cleanerReimbursementPaidAt?: string | null;
  reimbursementNote?: string;
  paidByName?: string | null;
  importedFromLegacy?: boolean;
  source?: string;
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

async function readLegacyStore(): Promise<StoredData> {
  const row = await db.appSetting.findUnique({ where: { key: SHOPPING_RUNS_KEY } });
  const value = row?.value;
  if (!value || typeof value !== "object" || Array.isArray(value)) return { runs: [] };
  const runs = Array.isArray((value as any).runs)
    ? ((value as any).runs as unknown[]).map(sanitizeRun).filter(Boolean) as ShoppingRunRecord[]
    : [];
  return { runs };
}

let legacyMigrationPromise: Promise<void> | null = null;

function parseCompatData(value: unknown): ShoppingRunCompatData {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const row = value as Record<string, unknown>;
  return {
    ownerScope:
      row.ownerScope === "CLIENT" || row.ownerScope === "ADMIN" ? (row.ownerScope as "CLIENT" | "ADMIN") : "CLEANER",
    planningScope: trimText(row.planningScope, 120) || undefined,
    clientChargeStatus: sanitizeClientChargeStatus(row.clientChargeStatus),
    cleanerReimbursementStatus: sanitizeCleanerReimbursementStatus(row.cleanerReimbursementStatus),
    clientChargeSentAt: trimText(row.clientChargeSentAt, 40) || null,
    clientChargePaidAt: trimText(row.clientChargePaidAt, 40) || null,
    cleanerReimbursementInvoicedAt: trimText(row.cleanerReimbursementInvoicedAt, 40) || null,
    cleanerReimbursementPaidAt: trimText(row.cleanerReimbursementPaidAt, 40) || null,
    reimbursementNote: trimText(row.reimbursementNote, 1000) || undefined,
    paidByName: trimText(row.paidByName, 160) || null,
    importedFromLegacy: row.importedFromLegacy === true,
    source: trimText(row.source, 60) || undefined,
  };
}

function serializeCompatData(input: ShoppingRunCompatData) {
  return {
    ownerScope: input.ownerScope ?? "CLEANER",
    planningScope: input.planningScope ?? "all",
    clientChargeStatus: input.clientChargeStatus ?? "NOT_REQUIRED",
    cleanerReimbursementStatus: input.cleanerReimbursementStatus ?? "NOT_APPLICABLE",
    clientChargeSentAt: input.clientChargeSentAt ?? null,
    clientChargePaidAt: input.clientChargePaidAt ?? null,
    cleanerReimbursementInvoicedAt: input.cleanerReimbursementInvoicedAt ?? null,
    cleanerReimbursementPaidAt: input.cleanerReimbursementPaidAt ?? null,
    reimbursementNote: input.reimbursementNote ?? null,
    paidByName: input.paidByName ?? null,
    importedFromLegacy: input.importedFromLegacy === true,
    source: input.source ?? "db",
  } as any;
}

function toDbPaymentMethod(method: ShoppingPaymentMethod | undefined): PrismaShoppingPaymentMethod {
  switch (method) {
    case "CLIENT_CARD":
      return PrismaShoppingPaymentMethod.CLIENT_CARD;
    case "CLEANER_PERSONAL_CARD":
      return PrismaShoppingPaymentMethod.CLEANER_CARD;
    case "ADMIN_PERSONAL_CARD":
      return PrismaShoppingPaymentMethod.ADMIN_CARD;
    case "CASH":
      return PrismaShoppingPaymentMethod.CASH;
    case "BANK_TRANSFER":
      return PrismaShoppingPaymentMethod.BANK_TRANSFER;
    case "OTHER":
      return PrismaShoppingPaymentMethod.OTHER;
    default:
      return PrismaShoppingPaymentMethod.COMPANY_CARD;
  }
}

function fromDbPaymentMethod(method: PrismaShoppingPaymentMethod | null | undefined): ShoppingPaymentMethod {
  switch (method) {
    case PrismaShoppingPaymentMethod.CLIENT_CARD:
      return "CLIENT_CARD";
    case PrismaShoppingPaymentMethod.CLEANER_CARD:
      return "CLEANER_PERSONAL_CARD";
    case PrismaShoppingPaymentMethod.ADMIN_CARD:
      return "ADMIN_PERSONAL_CARD";
    case PrismaShoppingPaymentMethod.CASH:
      return "CASH";
    case PrismaShoppingPaymentMethod.BANK_TRANSFER:
      return "BANK_TRANSFER";
    case PrismaShoppingPaymentMethod.OTHER:
      return "OTHER";
    default:
      return "COMPANY_CARD";
  }
}

function toDbPaidByScope(scope: ShoppingPaidByScope | undefined): PrismaShoppingPaidByScope {
  switch (scope) {
    case "CLIENT":
      return PrismaShoppingPaidByScope.CLIENT;
    case "CLEANER":
      return PrismaShoppingPaidByScope.CLEANER;
    case "ADMIN":
      return PrismaShoppingPaidByScope.ADMIN;
    case "OTHER":
      return PrismaShoppingPaidByScope.OTHER;
    default:
      return PrismaShoppingPaidByScope.COMPANY;
  }
}

function fromDbPaidByScope(scope: PrismaShoppingPaidByScope | null | undefined): ShoppingPaidByScope {
  switch (scope) {
    case PrismaShoppingPaidByScope.CLIENT:
      return "CLIENT";
    case PrismaShoppingPaidByScope.CLEANER:
      return "CLEANER";
    case PrismaShoppingPaidByScope.ADMIN:
      return "ADMIN";
    case PrismaShoppingPaidByScope.OTHER:
      return "OTHER";
    default:
      return "COMPANY";
  }
}

function toDbRunStatus(
  status: ShoppingRunStatus,
  current?: PrismaShoppingRunStatus | null
): PrismaShoppingRunStatus {
  if (status === "DRAFT") return PrismaShoppingRunStatus.DRAFT;
  if (status === "IN_PROGRESS") return PrismaShoppingRunStatus.ACTIVE;
  if (
    current === PrismaShoppingRunStatus.APPROVED ||
    current === PrismaShoppingRunStatus.BILLED ||
    current === PrismaShoppingRunStatus.REIMBURSED ||
    current === PrismaShoppingRunStatus.CLOSED
  ) {
    return current;
  }
  return PrismaShoppingRunStatus.SUBMITTED;
}

function fromDbRunStatus(status: PrismaShoppingRunStatus): ShoppingRunStatus {
  if (status === PrismaShoppingRunStatus.DRAFT) return "DRAFT";
  if (status === PrismaShoppingRunStatus.ACTIVE) return "IN_PROGRESS";
  return "COMPLETED";
}

function parseDateOrNull(value: string | null | undefined) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function buildFallbackPayment(ownerScope: ShoppingRunOwnerScope | "ADMIN"): ShoppingRunPayment {
  return {
    method: ownerScope === "CLIENT" ? "CLIENT_CARD" : "COMPANY_CARD",
    paidByScope: ownerScope === "CLIENT" ? "CLIENT" : "COMPANY",
    paidByUserId: null,
    paidByName: null,
    note: undefined,
    receipts: [],
  };
}

function deriveClientChargeStatus(
  compat: ShoppingRunCompatData,
  payment: ShoppingRunPayment,
  actualTotalCost: number,
  hasClient: boolean,
  hasClientInvoice: boolean
): ShoppingRunClientChargeStatus {
  if (compat.clientChargeStatus) return compat.clientChargeStatus;
  if (hasClientInvoice) return "SENT";
  if (actualTotalCost <= 0 || !requiresClientReimbursement(payment, hasClient)) return "NOT_REQUIRED";
  return "READY";
}

function deriveCleanerReimbursementStatus(
  compat: ShoppingRunCompatData,
  payment: ShoppingRunPayment,
  actualTotalCost: number,
  includedInCleanerInvoiceReference?: string | null
): ShoppingRunCleanerReimbursementStatus {
  if (compat.cleanerReimbursementStatus) return compat.cleanerReimbursementStatus;
  if (includedInCleanerInvoiceReference) return "INVOICED";
  if (actualTotalCost <= 0 || !requiresCleanerReimbursement(payment)) return "NOT_APPLICABLE";
  return "READY";
}

function reconcileDbStatusFromCompat(
  current: PrismaShoppingRunStatus,
  compat: ShoppingRunCompatData
): PrismaShoppingRunStatus {
  if (
    compat.clientChargeStatus === "PAID" &&
    (compat.cleanerReimbursementStatus === "REIMBURSED" ||
      compat.cleanerReimbursementStatus === "NOT_APPLICABLE" ||
      !compat.cleanerReimbursementStatus)
  ) {
    return PrismaShoppingRunStatus.CLOSED;
  }
  if (compat.cleanerReimbursementStatus === "REIMBURSED") {
    return PrismaShoppingRunStatus.REIMBURSED;
  }
  if (compat.clientChargeStatus === "SENT" || compat.clientChargeStatus === "PAID") {
    return PrismaShoppingRunStatus.BILLED;
  }
  if (
    compat.clientChargeStatus === "READY" ||
    compat.cleanerReimbursementStatus === "READY" ||
    compat.cleanerReimbursementStatus === "INVOICED"
  ) {
    return current === PrismaShoppingRunStatus.DRAFT || current === PrismaShoppingRunStatus.ACTIVE
      ? PrismaShoppingRunStatus.APPROVED
      : current;
  }
  return current;
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

async function ensureLegacyShoppingRunsMigrated() {
  if (!legacyMigrationPromise) {
    legacyMigrationPromise = (async () => {
      const legacy = await readLegacyStore();
      if (legacy.runs.length === 0) return;

      const existing = await db.shoppingRun.findMany({
        where: { id: { in: legacy.runs.map((run) => run.id) } },
        select: { id: true },
      });
      const existingIds = new Set(existing.map((row) => row.id));
      const pending = legacy.runs.filter((run) => !existingIds.has(run.id));
      if (pending.length === 0) return;

      const propertyIds = Array.from(new Set(pending.flatMap((run) => run.rows.map((row) => row.propertyId))));
      const itemIds = Array.from(new Set(pending.flatMap((run) => run.rows.map((row) => row.itemId))));
      const clientIds = Array.from(
        new Set(pending.map((run) => run.clientId).filter((value): value is string => Boolean(value)))
      );
      const ownerIds = Array.from(new Set(pending.map((run) => run.ownerUserId)));

      const [users, clients, properties, items] = await Promise.all([
        db.user.findMany({
          where: {
            OR: [
              { id: { in: ownerIds } },
              { role: { in: [Role.ADMIN, Role.OPS_MANAGER] } },
              { clientId: { in: clientIds } },
            ],
          },
          select: { id: true, clientId: true, role: true },
        }),
        db.client.findMany({ where: { id: { in: clientIds } }, select: { id: true } }),
        db.property.findMany({ where: { id: { in: propertyIds } }, select: { id: true } }),
        db.inventoryItem.findMany({ where: { id: { in: itemIds } }, select: { id: true } }),
      ]);

      const userMap = new Map(users.map((user) => [user.id, user]));
      const clientSet = new Set(clients.map((client) => client.id));
      const propertySet = new Set(properties.map((property) => property.id));
      const itemSet = new Set(items.map((item) => item.id));
      const clientUserMap = new Map<string, string>();
      for (const user of users) {
        if (user.clientId && !clientUserMap.has(user.clientId)) {
          clientUserMap.set(user.clientId, user.id);
        }
      }
      const fallbackOwnerId =
        users.find((user) => user.role === Role.ADMIN)?.id ??
        users.find((user) => user.role === Role.OPS_MANAGER)?.id ??
        users[0]?.id;
      if (!fallbackOwnerId) return;

      for (const legacyRun of pending) {
        const compat: ShoppingRunCompatData = {
          ownerScope: legacyRun.ownerScope,
          planningScope: legacyRun.planningScope,
          clientChargeStatus: legacyRun.clientChargeStatus,
          cleanerReimbursementStatus: legacyRun.cleanerReimbursementStatus,
          clientChargeSentAt: legacyRun.clientChargeSentAt,
          clientChargePaidAt: legacyRun.clientChargePaidAt,
          cleanerReimbursementInvoicedAt: legacyRun.cleanerReimbursementInvoicedAt,
          cleanerReimbursementPaidAt: legacyRun.cleanerReimbursementPaidAt,
          reimbursementNote: legacyRun.reimbursementNote,
          paidByName: legacyRun.payment.paidByName ?? null,
          importedFromLegacy: true,
          source: "legacy-json",
        };
        const resolvedClientId =
          legacyRun.clientId && clientSet.has(legacyRun.clientId) ? legacyRun.clientId : null;
        const ownerId =
          userMap.get(legacyRun.ownerUserId)?.id ??
          (resolvedClientId ? clientUserMap.get(resolvedClientId) : undefined) ??
          fallbackOwnerId;
        const validRows = legacyRun.rows
          .filter((row) => propertySet.has(row.propertyId))
          .map((row) => ({
            propertyId: row.propertyId,
            itemId: itemSet.has(row.itemId) ? row.itemId : null,
            itemName: row.itemName,
            category: row.category,
            supplier: row.supplier ?? null,
            unit: row.unit,
            plannedQty: Math.max(0, row.plannedQty),
            purchasedQty: Math.max(0, row.actualPurchasedQty),
            unitCost: row.actualUnitCost ?? null,
            lineCost:
              row.actualLineCost ??
              (row.actualUnitCost != null ? row.actualPurchasedQty * row.actualUnitCost : null),
            status: row.purchased ? "PURCHASED" : row.include ? "PLANNED" : "SKIPPED",
            note: row.note ?? null,
          }));

        await db.shoppingRun.create({
          data: {
            id: legacyRun.id,
            ownerUserId: ownerId,
            clientId: resolvedClientId,
            status: reconcileDbStatusFromCompat(toDbRunStatus(legacyRun.status), compat),
            title: legacyRun.name,
            notes: legacyRun.reimbursementNote ?? null,
            startedAt: parseDateOrNull(legacyRun.startedAt),
            submittedAt:
              parseDateOrNull(legacyRun.completedAt) ??
              (legacyRun.status === "COMPLETED" ? parseDateOrNull(legacyRun.updatedAt) : null),
            approvedAt:
              legacyRun.clientChargeStatus === "READY" ||
              legacyRun.cleanerReimbursementStatus === "READY" ||
              legacyRun.cleanerReimbursementStatus === "INVOICED"
                ? parseDateOrNull(legacyRun.updatedAt)
                : null,
            closedAt:
              legacyRun.clientChargeStatus === "PAID" ||
              legacyRun.cleanerReimbursementStatus === "REIMBURSED"
                ? parseDateOrNull(
                    legacyRun.clientChargePaidAt ??
                      legacyRun.cleanerReimbursementPaidAt ??
                      legacyRun.updatedAt
                  )
                : null,
            createdAt: parseDateOrNull(legacyRun.createdAt) ?? new Date(),
            updatedAt: parseDateOrNull(legacyRun.updatedAt) ?? new Date(),
            legacySource: serializeCompatData(compat),
            lines: { create: validRows },
            receipts: {
              create: legacyRun.payment.receipts.map((receipt) => ({
                uploadedByUserId: ownerId,
                s3Key: receipt.key,
                url: receipt.url,
                mimeType: receipt.mimeType ?? null,
                fileName: receipt.name,
                amount: null,
                createdAt: parseDateOrNull(legacyRun.updatedAt) ?? new Date(),
              })),
            },
            settlements: {
              create: [
                {
                  paymentMethod: toDbPaymentMethod(legacyRun.payment.method),
                  paidByScope: toDbPaidByScope(legacyRun.payment.paidByScope),
                  paidByUserId:
                    legacyRun.payment.paidByUserId && userMap.has(legacyRun.payment.paidByUserId)
                      ? legacyRun.payment.paidByUserId
                      : null,
                  note: legacyRun.payment.note ?? null,
                  clientBillable: legacyRun.clientChargeStatus !== "NOT_REQUIRED",
                  adminApprovedForClient:
                    legacyRun.clientChargeStatus === "READY" ||
                    legacyRun.clientChargeStatus === "SENT" ||
                    legacyRun.clientChargeStatus === "PAID",
                  adminApprovedForCleanerReimbursement:
                    legacyRun.cleanerReimbursementStatus === "READY" ||
                    legacyRun.cleanerReimbursementStatus === "INVOICED" ||
                    legacyRun.cleanerReimbursementStatus === "REIMBURSED",
                  includeInCleanerInvoice:
                    legacyRun.cleanerReimbursementStatus === "READY" ||
                    legacyRun.cleanerReimbursementStatus === "INVOICED" ||
                    legacyRun.cleanerReimbursementStatus === "REIMBURSED",
                  includedInCleanerInvoiceReference:
                    legacyRun.cleanerReimbursementStatus === "INVOICED" ||
                    legacyRun.cleanerReimbursementStatus === "REIMBURSED"
                      ? `legacy:${legacyRun.id}`
                      : null,
                  createdAt: parseDateOrNull(legacyRun.createdAt) ?? new Date(),
                  updatedAt: parseDateOrNull(legacyRun.updatedAt) ?? new Date(),
                },
              ],
            },
          },
        });
      }
    })();
  }
  await legacyMigrationPromise;
}

function buildShoppingRunRecordFromDb(run: any): ShoppingRunRecord {
  const compat = parseCompatData(run.legacySource);
  const ownerScope =
    compat.ownerScope === "CLIENT" || compat.ownerScope === "ADMIN"
      ? compat.ownerScope
      : run.owner?.role === Role.CLIENT
        ? "CLIENT"
        : "CLEANER";
  const settlement = Array.isArray(run.settlements) ? run.settlements[0] ?? null : null;
  const payment = settlement
    ? ({
        method: fromDbPaymentMethod(settlement.paymentMethod),
        paidByScope: fromDbPaidByScope(settlement.paidByScope),
        paidByUserId: settlement.paidByUserId ?? null,
        paidByName:
          compat.paidByName ??
          settlement.paidByUser?.name?.trim() ??
          settlement.paidByUser?.email?.trim() ??
          null,
        note: settlement.note ?? undefined,
        receipts: Array.isArray(run.receipts)
          ? run.receipts.map((receipt: any) => ({
              key: receipt.s3Key,
              url: receipt.url,
              name: receipt.fileName,
              mimeType: receipt.mimeType ?? undefined,
            }))
          : [],
      } satisfies ShoppingRunPayment)
    : buildFallbackPayment(ownerScope);
  const rows: ShoppingRunRow[] = Array.isArray(run.lines)
    ? run.lines.map((line: any) => ({
        propertyId: line.propertyId,
        propertyName: line.property?.name ?? "Property",
        suburb: line.property?.suburb ?? "",
        itemId: line.itemId ?? line.item?.id ?? line.id,
        itemName: line.itemName ?? line.item?.name ?? "Item",
        category: line.category ?? line.item?.category ?? "General",
        supplier: line.supplier ?? line.item?.supplier ?? null,
        unit: line.unit ?? line.item?.unit ?? "unit",
        onHand: 0,
        parLevel: 0,
        reorderThreshold: 0,
        needed: Math.max(0, Number(line.plannedQty ?? 0)),
        plannedQty: Math.max(0, Number(line.plannedQty ?? 0)),
        include: Number(line.plannedQty ?? 0) > 0 || line.status !== "SKIPPED",
        purchased: Number(line.purchasedQty ?? 0) > 0 || line.status === "PURCHASED",
        actualPurchasedQty: Math.max(0, Number(line.purchasedQty ?? 0)),
        actualUnitCost: line.unitCost ?? null,
        actualLineCost: line.lineCost ?? null,
        checkedAt: line.updatedAt?.toISOString?.() ?? undefined,
        note: line.note ?? undefined,
        estimatedUnitCost: line.unitCost ?? null,
        estimatedLineCost: line.lineCost ?? null,
      }))
    : [];
  const hasClient = Boolean(
    run.clientId ||
      rows.some((row) =>
        Boolean(run.lines?.find((line: any) => line.propertyId === row.propertyId)?.property?.client?.id)
      )
  );
  const totals = computeShoppingRunTotals(rows, payment, hasClient);
  return {
    id: run.id,
    name: run.title,
    status: fromDbRunStatus(run.status),
    ownerScope: ownerScope === "CLIENT" ? "CLIENT" : "CLEANER",
    ownerUserId: run.ownerUserId,
    clientId: run.clientId ?? null,
    planningScope: compat.planningScope ?? "all",
    rows,
    payment,
    totals,
    startedAt: run.startedAt?.toISOString?.() ?? null,
    completedAt:
      run.submittedAt?.toISOString?.() ??
      run.approvedAt?.toISOString?.() ??
      run.closedAt?.toISOString?.() ??
      null,
    clientChargeStatus: deriveClientChargeStatus(
      compat,
      payment,
      totals.actualTotalCost,
      hasClient,
      Boolean(settlement?.includedInClientInvoiceId)
    ),
    cleanerReimbursementStatus: deriveCleanerReimbursementStatus(
      compat,
      payment,
      totals.actualTotalCost,
      settlement?.includedInCleanerInvoiceReference
    ),
    clientChargeSentAt: compat.clientChargeSentAt ?? null,
    clientChargePaidAt: compat.clientChargePaidAt ?? null,
    cleanerReimbursementInvoicedAt: compat.cleanerReimbursementInvoicedAt ?? null,
    cleanerReimbursementPaidAt: compat.cleanerReimbursementPaidAt ?? null,
    reimbursementNote: compat.reimbursementNote,
    createdAt: run.createdAt.toISOString(),
    updatedAt: run.updatedAt.toISOString(),
  };
}

async function loadShoppingRunsFromDb(where?: Record<string, unknown>) {
  await ensureLegacyShoppingRunsMigrated();
  return db.shoppingRun.findMany({
    where: where as any,
    include: {
      owner: { select: { id: true, name: true, email: true, role: true } },
      client: { select: { id: true, name: true, email: true } },
      lines: {
        include: {
          property: {
            select: {
              id: true,
              name: true,
              suburb: true,
              client: { select: { id: true, name: true, email: true } },
            },
          },
          item: { select: { id: true, name: true, category: true, supplier: true, unit: true } },
        },
        orderBy: [{ createdAt: "asc" }],
      },
      receipts: { orderBy: [{ createdAt: "asc" }] },
      settlements: {
        include: {
          paidByUser: { select: { id: true, name: true, email: true } },
          clientInvoice: { select: { id: true, status: true, invoiceNumber: true } },
        },
        orderBy: [{ createdAt: "desc" }],
        take: 1,
      },
    },
    orderBy: [{ updatedAt: "desc" }],
  });
}

export async function listShoppingRunsForOwner(input: {
  ownerScope: ShoppingRunOwnerScope;
  ownerUserId: string;
  clientId?: string | null;
}) {
  if (input.ownerScope === "CLIENT" && !input.clientId) return [];
  const dbRuns = await loadShoppingRunsFromDb(
    input.ownerScope === "CLIENT"
      ? { OR: [{ clientId: input.clientId }, { ownerUserId: input.ownerUserId }] }
      : { ownerUserId: input.ownerUserId }
  );
  return dbRuns
    .map((run) => buildShoppingRunRecordFromDb(run))
    .filter((run) => {
      if (run.ownerScope !== input.ownerScope) return false;
      if (run.ownerScope === "CLIENT") {
        return Boolean(run.clientId && input.clientId && run.clientId === input.clientId);
      }
      return run.ownerUserId === input.ownerUserId;
    })
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function listShoppingRunsForAdmin() {
  const dbRuns = await loadShoppingRunsFromDb();
  return dbRuns.map((run) => buildShoppingRunRecordFromDb(run));
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
  const dbRuns = await loadShoppingRunsFromDb({ id });
  return dbRuns[0] ? buildShoppingRunRecordFromDb(dbRuns[0]) : null;
}

export async function listShoppingRunsForAdminDetailed(): Promise<ShoppingRunAdminView[]> {
  const dbRuns = await loadShoppingRunsFromDb();
  return dbRuns.map((dbRun) => {
    const run = buildShoppingRunRecordFromDb(dbRun);
    const allocations = new Map<string, ShoppingRunClientAllocation>();
    for (const row of run.rows) {
      const property = dbRun.lines.find((line: any) => line.propertyId === row.propertyId)?.property;
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

    return {
      ...run,
      ownerName: dbRun.owner?.name?.trim() || dbRun.owner?.email || "Unknown user",
      ownerEmail: dbRun.owner?.email ?? "",
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
  await ensureLegacyShoppingRunsMigrated();
  const now = new Date();
  const existingRows = input.id ? await loadShoppingRunsFromDb({ id: input.id }) : [];
  const existing = existingRows[0] ?? null;
  const existingRecord = existing ? buildShoppingRunRecordFromDb(existing) : null;

  if (existingRecord) {
    if (existingRecord.ownerScope !== input.ownerScope) throw new Error("FORBIDDEN");
    if (input.ownerScope === "CLIENT") {
      if (!existingRecord.clientId || existingRecord.clientId !== (input.clientId ?? null)) {
        throw new Error("FORBIDDEN");
      }
    } else if (existingRecord.ownerUserId !== input.ownerUserId) {
      throw new Error("FORBIDDEN");
    }
  }

  const ownerScope = existingRecord?.ownerScope ?? input.ownerScope;
  const payment = sanitizePayment(
    {
      ...(existingRecord?.payment ?? buildFallbackPayment(ownerScope)),
      ...(input.payment ?? {}),
      receipts: input.payment?.receipts ?? existingRecord?.payment.receipts ?? [],
    },
    ownerScope
  );
  const hasClient = Boolean(existing?.clientId ?? input.clientId);
  const totals = computeShoppingRunTotals(input.rows, payment, hasClient);
  const existingCompat = existing ? parseCompatData(existing.legacySource) : {};
  const compat: ShoppingRunCompatData = {
    ...existingCompat,
    ownerScope,
    planningScope: input.planningScope || existingCompat.planningScope || "all",
    reimbursementNote:
      input.reimbursementNote !== undefined
        ? trimText(input.reimbursementNote, 1000) || undefined
        : existingCompat.reimbursementNote,
    paidByName: payment.paidByName ?? existingCompat.paidByName ?? null,
    source: existingCompat.importedFromLegacy ? existingCompat.source ?? "legacy-json" : "db",
  };

  compat.clientChargeStatus =
    existingCompat.clientChargeStatus === "PAID" || existingCompat.clientChargeStatus === "SENT"
      ? existingCompat.clientChargeStatus
      : totals.actualTotalCost > 0 && requiresClientReimbursement(payment, hasClient)
        ? "READY"
        : "NOT_REQUIRED";
  compat.cleanerReimbursementStatus =
    existingCompat.cleanerReimbursementStatus === "INVOICED" ||
    existingCompat.cleanerReimbursementStatus === "REIMBURSED"
      ? existingCompat.cleanerReimbursementStatus
      : totals.actualTotalCost > 0 && requiresCleanerReimbursement(payment)
        ? "READY"
        : "NOT_APPLICABLE";

  const nextStatus = reconcileDbStatusFromCompat(
    toDbRunStatus(input.status, existing?.status ?? null),
    compat
  );
  const runId = existing?.id ?? randomUUID();
  const startedAt =
    input.startedAt !== undefined
      ? parseDateOrNull(input.startedAt)
      : existing?.startedAt ?? (input.status !== "DRAFT" ? now : null);
  const submittedAt =
    input.completedAt !== undefined
      ? parseDateOrNull(input.completedAt)
      : input.status === "COMPLETED"
        ? existing?.submittedAt ?? now
        : null;
  const itemIds = Array.from(new Set(input.rows.map((row) => row.itemId)));
  const validItemIds = new Set(
    (
      await db.inventoryItem.findMany({
        where: { id: { in: itemIds } },
        select: { id: true },
      })
    ).map((item) => item.id)
  );

  await db.$transaction(async (tx) => {
    const lineCreates = input.rows.map((row) => ({
      propertyId: row.propertyId,
      itemId: validItemIds.has(row.itemId) ? row.itemId : null,
      itemName: row.itemName,
      category: row.category,
      supplier: row.supplier ?? null,
      unit: row.unit,
      plannedQty: Math.max(0, row.plannedQty),
      purchasedQty: Math.max(0, row.actualPurchasedQty),
      unitCost: row.actualUnitCost ?? null,
      lineCost:
        row.actualLineCost ??
        (row.actualUnitCost != null ? Math.max(0, row.actualPurchasedQty) * row.actualUnitCost : null),
      status: row.purchased ? "PURCHASED" : row.include ? "PLANNED" : "SKIPPED",
      note: row.note ?? null,
    }));
    const receiptCreates = payment.receipts.map((receipt) => ({
      uploadedByUserId: input.ownerUserId,
      s3Key: receipt.key,
      url: receipt.url,
      mimeType: receipt.mimeType ?? null,
      fileName: receipt.name,
      amount: null,
    }));
    const settlementCreate = {
      paymentMethod: toDbPaymentMethod(payment.method),
      paidByScope: toDbPaidByScope(payment.paidByScope),
      paidByUserId: payment.paidByUserId ?? null,
      note: payment.note ?? null,
      clientBillable: compat.clientChargeStatus !== "NOT_REQUIRED",
      adminApprovedForClient:
        compat.clientChargeStatus === "READY" ||
        compat.clientChargeStatus === "SENT" ||
        compat.clientChargeStatus === "PAID",
      adminApprovedForCleanerReimbursement:
        compat.cleanerReimbursementStatus === "READY" ||
        compat.cleanerReimbursementStatus === "INVOICED" ||
        compat.cleanerReimbursementStatus === "REIMBURSED",
      includeInCleanerInvoice:
        compat.cleanerReimbursementStatus === "READY" ||
        compat.cleanerReimbursementStatus === "INVOICED" ||
        compat.cleanerReimbursementStatus === "REIMBURSED",
      includedInClientInvoiceId: existing?.settlements?.[0]?.includedInClientInvoiceId ?? null,
      includedInCleanerInvoiceReference:
        compat.cleanerReimbursementStatus === "INVOICED" ||
        compat.cleanerReimbursementStatus === "REIMBURSED"
          ? existing?.settlements?.[0]?.includedInCleanerInvoiceReference ?? `run:${runId}`
          : null,
    };

    if (existing) {
      await tx.shoppingRun.update({
        where: { id: existing.id },
        data: {
          title: input.name,
          status: nextStatus,
          clientId: input.clientId ?? existing.clientId ?? null,
          notes: compat.reimbursementNote ?? null,
          startedAt,
          submittedAt,
          approvedAt:
            compat.clientChargeStatus === "READY" ||
            compat.cleanerReimbursementStatus === "READY" ||
            compat.cleanerReimbursementStatus === "INVOICED"
              ? existing.approvedAt ?? now
              : existing.approvedAt,
          legacySource: serializeCompatData(compat),
          lines: { deleteMany: {}, create: lineCreates },
          receipts: { deleteMany: {}, create: receiptCreates },
          settlements: { deleteMany: {}, create: [settlementCreate] },
        },
      });
      return;
    }

    await tx.shoppingRun.create({
      data: {
        id: runId,
        ownerUserId: input.ownerUserId,
        clientId: input.clientId ?? null,
        status: nextStatus,
        title: input.name,
        notes: compat.reimbursementNote ?? null,
        startedAt,
        submittedAt,
        legacySource: serializeCompatData(compat),
        lines: { create: lineCreates },
        receipts: { create: receiptCreates },
        settlements: { create: [settlementCreate] },
      },
    });
  });

  const saved = await getShoppingRunByIdForAdmin(runId);
  if (!saved) throw new Error("Save failed.");
  return saved;
}

export async function deleteShoppingRunForOwner(input: {
  id: string;
  ownerScope: ShoppingRunOwnerScope;
  ownerUserId: string;
  clientId?: string | null;
}) {
  const dbRuns = await loadShoppingRunsFromDb({ id: input.id });
  const existing = dbRuns[0];
  if (!existing) return false;
  const run = buildShoppingRunRecordFromDb(existing);
  if (run.ownerScope !== input.ownerScope) return false;
  if (input.ownerScope === "CLIENT") {
    if (!(run.clientId && input.clientId && run.clientId === input.clientId)) return false;
  } else if (run.ownerUserId !== input.ownerUserId) {
    return false;
  }
  await db.shoppingRun.delete({ where: { id: input.id } });
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
  const dbRuns = await loadShoppingRunsFromDb({ id: input.id });
  const existing = dbRuns[0];
  if (!existing) throw new Error("NOT_FOUND");
  const current = buildShoppingRunRecordFromDb(existing);
  const currentCompat = parseCompatData(existing.legacySource);
  const payment = sanitizePayment(
    {
      ...current.payment,
      ...(input.payment ?? {}),
      receipts: input.payment?.receipts ?? current.payment.receipts,
    },
    current.ownerScope
  );
  const compat: ShoppingRunCompatData = {
    ...currentCompat,
    ownerScope: current.ownerScope,
    planningScope: current.planningScope,
    paidByName: payment.paidByName ?? currentCompat.paidByName ?? null,
    clientChargeStatus: input.clientChargeStatus ?? current.clientChargeStatus,
    cleanerReimbursementStatus:
      input.cleanerReimbursementStatus ?? current.cleanerReimbursementStatus,
    clientChargeSentAt:
      input.clientChargeSentAt !== undefined ? input.clientChargeSentAt : current.clientChargeSentAt,
    clientChargePaidAt:
      input.clientChargePaidAt !== undefined ? input.clientChargePaidAt : current.clientChargePaidAt,
    cleanerReimbursementInvoicedAt:
      input.cleanerReimbursementInvoicedAt !== undefined
        ? input.cleanerReimbursementInvoicedAt
        : current.cleanerReimbursementInvoicedAt,
    cleanerReimbursementPaidAt:
      input.cleanerReimbursementPaidAt !== undefined
        ? input.cleanerReimbursementPaidAt
        : current.cleanerReimbursementPaidAt,
    reimbursementNote:
      input.reimbursementNote === null ? undefined : input.reimbursementNote ?? current.reimbursementNote,
    source: currentCompat.source ?? "db",
  };

  await db.shoppingRun.update({
    where: { id: input.id },
    data: {
      status: reconcileDbStatusFromCompat(
        input.status ? toDbRunStatus(input.status, existing.status) : existing.status,
        compat
      ),
      notes: compat.reimbursementNote ?? null,
      approvedAt:
        compat.clientChargeStatus === "READY" ||
        compat.cleanerReimbursementStatus === "READY" ||
        compat.cleanerReimbursementStatus === "INVOICED"
          ? existing.approvedAt ?? new Date()
          : existing.approvedAt,
      closedAt:
        compat.clientChargeStatus === "PAID" ||
        compat.cleanerReimbursementStatus === "REIMBURSED"
          ? existing.closedAt ?? new Date()
          : existing.closedAt,
      legacySource: serializeCompatData(compat),
      receipts: {
        deleteMany: {},
        create: payment.receipts.map((receipt) => ({
          uploadedByUserId: existing.ownerUserId,
          s3Key: receipt.key,
          url: receipt.url,
          mimeType: receipt.mimeType ?? null,
          fileName: receipt.name,
          amount: null,
        })),
      },
      settlements: {
        deleteMany: {},
        create: [
          {
            paymentMethod: toDbPaymentMethod(payment.method),
            paidByScope: toDbPaidByScope(payment.paidByScope),
            paidByUserId: payment.paidByUserId ?? null,
            note: payment.note ?? null,
            clientBillable: compat.clientChargeStatus !== "NOT_REQUIRED",
            adminApprovedForClient:
              compat.clientChargeStatus === "READY" ||
              compat.clientChargeStatus === "SENT" ||
              compat.clientChargeStatus === "PAID",
            adminApprovedForCleanerReimbursement:
              compat.cleanerReimbursementStatus === "READY" ||
              compat.cleanerReimbursementStatus === "INVOICED" ||
              compat.cleanerReimbursementStatus === "REIMBURSED",
            includeInCleanerInvoice:
              compat.cleanerReimbursementStatus === "READY" ||
              compat.cleanerReimbursementStatus === "INVOICED" ||
              compat.cleanerReimbursementStatus === "REIMBURSED",
            includedInClientInvoiceId: existing.settlements?.[0]?.includedInClientInvoiceId ?? null,
            includedInCleanerInvoiceReference:
              compat.cleanerReimbursementStatus === "INVOICED" ||
              compat.cleanerReimbursementStatus === "REIMBURSED"
                ? existing.settlements?.[0]?.includedInCleanerInvoiceReference ?? `run:${input.id}`
                : null,
          },
        ],
      },
    },
  });

  const saved = await getShoppingRunByIdForAdmin(input.id);
  if (!saved) throw new Error("NOT_FOUND");
  return saved;
}

export async function markCleanerShoppingRunsInvoiced(input: {
  cleanerId: string;
  runIds: string[];
}) {
  if (input.runIds.length === 0) return;
  const dbRuns = await loadShoppingRunsFromDb({ id: { in: input.runIds } });
  const now = new Date().toISOString();
  for (const run of dbRuns) {
    const current = buildShoppingRunRecordFromDb(run);
    if (current.payment.paidByScope !== "CLEANER") continue;
    if (current.payment.paidByUserId && current.payment.paidByUserId !== input.cleanerId) continue;
    const compat: ShoppingRunCompatData = {
      ...parseCompatData(run.legacySource),
      ownerScope: current.ownerScope,
      planningScope: current.planningScope,
      clientChargeStatus: current.clientChargeStatus,
      cleanerReimbursementStatus: "INVOICED",
      cleanerReimbursementInvoicedAt: now,
      reimbursementNote: current.reimbursementNote,
      paidByName: current.payment.paidByName ?? null,
      source: parseCompatData(run.legacySource).source ?? "db",
    };
    await db.shoppingRun.update({
      where: { id: run.id },
      data: {
        status: reconcileDbStatusFromCompat(run.status, compat),
        legacySource: serializeCompatData(compat),
        settlements: {
          deleteMany: {},
          create: [
            {
              paymentMethod: toDbPaymentMethod(current.payment.method),
              paidByScope: toDbPaidByScope(current.payment.paidByScope),
              paidByUserId: current.payment.paidByUserId ?? null,
              note: current.payment.note ?? null,
              clientBillable: current.clientChargeStatus !== "NOT_REQUIRED",
              adminApprovedForClient:
                current.clientChargeStatus === "READY" ||
                current.clientChargeStatus === "SENT" ||
                current.clientChargeStatus === "PAID",
              adminApprovedForCleanerReimbursement: true,
              includeInCleanerInvoice: true,
              includedInClientInvoiceId: run.settlements?.[0]?.includedInClientInvoiceId ?? null,
              includedInCleanerInvoiceReference:
                run.settlements?.[0]?.includedInCleanerInvoiceReference ?? `run:${run.id}`,
            },
          ],
        },
      },
    });
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

