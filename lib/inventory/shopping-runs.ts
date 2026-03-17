import { randomUUID } from "crypto";
import { db } from "@/lib/db";

const SHOPPING_RUNS_KEY = "inventory_shopping_runs_v1";

export type ShoppingRunStatus = "DRAFT" | "IN_PROGRESS" | "COMPLETED";
export type ShoppingRunOwnerScope = "CLIENT" | "CLEANER";

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
  estimatedTotalCost: number;
  byProperty: Array<{
    propertyId: string;
    propertyName: string;
    suburb: string;
    lineCount: number;
    plannedUnits: number;
    estimatedCost: number;
    emergencyCount: number;
  }>;
  bySupplier: Array<{
    supplier: string;
    category: string;
    lineCount: number;
    plannedUnits: number;
    estimatedCost: number;
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
  totals: ShoppingRunTotals;
  createdAt: string;
  updatedAt: string;
};

type StoredData = {
  runs: ShoppingRunRecord[];
};

function toNumber(value: unknown, fallback = 0): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function sanitizeStatus(value: unknown): ShoppingRunStatus {
  return value === "IN_PROGRESS" || value === "COMPLETED" ? value : "DRAFT";
}

function sanitizeOwnerScope(value: unknown): ShoppingRunOwnerScope {
  return value === "CLIENT" ? "CLIENT" : "CLEANER";
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

  return {
    propertyId,
    propertyName,
    suburb: String(r.suburb ?? ""),
    itemId,
    itemName,
    category: String(r.category ?? "General"),
    supplier: r.supplier == null ? null : String(r.supplier),
    unit: String(r.unit ?? "unit"),
    onHand: toNumber(r.onHand, 0),
    parLevel: toNumber(r.parLevel, 0),
    reorderThreshold: toNumber(r.reorderThreshold, 0),
    needed: Math.max(0, toNumber(r.needed, 0)),
    plannedQty: Math.max(0, toNumber(r.plannedQty, 0)),
    include: Boolean(r.include),
    purchased: Boolean(r.purchased),
    note: typeof r.note === "string" ? r.note.slice(0, 500) : undefined,
    priority,
    estimatedUnitCost: estimatedUnitCost == null ? null : Math.max(0, estimatedUnitCost),
    estimatedLineCost: estimatedLineCost == null ? null : Math.max(0, estimatedLineCost),
  };
}

function sanitizeTotals(value: unknown, rows: ShoppingRunRow[]): ShoppingRunTotals {
  const fallback = computeShoppingRunTotals(rows);
  if (!value || typeof value !== "object" || Array.isArray(value)) return fallback;
  const v = value as Record<string, unknown>;
  return {
    lineCount: toNumber(v.lineCount, fallback.lineCount),
    includedLineCount: toNumber(v.includedLineCount, fallback.includedLineCount),
    purchasedLineCount: toNumber(v.purchasedLineCount, fallback.purchasedLineCount),
    totalNeededUnits: toNumber(v.totalNeededUnits, fallback.totalNeededUnits),
    plannedUnits: toNumber(v.plannedUnits, fallback.plannedUnits),
    estimatedTotalCost: toNumber(v.estimatedTotalCost, fallback.estimatedTotalCost),
    byProperty: Array.isArray(v.byProperty)
      ? (v.byProperty as any[]).map((row) => ({
          propertyId: String(row?.propertyId ?? ""),
          propertyName: String(row?.propertyName ?? ""),
          suburb: String(row?.suburb ?? ""),
          lineCount: toNumber(row?.lineCount, 0),
          plannedUnits: toNumber(row?.plannedUnits, 0),
          estimatedCost: toNumber(row?.estimatedCost, 0),
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
  return {
    id,
    name: String(v.name ?? "Shopping Run"),
    status: sanitizeStatus(v.status),
    ownerScope: sanitizeOwnerScope(v.ownerScope),
    ownerUserId,
    clientId: v.clientId == null ? null : String(v.clientId),
    planningScope: String(v.planningScope ?? "all"),
    rows,
    totals: sanitizeTotals(v.totals, rows),
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

export function computeShoppingRunTotals(rows: ShoppingRunRow[]): ShoppingRunTotals {
  const includedRows = rows.filter((row) => row.include);
  const byPropertyMap = new Map<string, ShoppingRunTotals["byProperty"][number]>();
  const bySupplierMap = new Map<string, ShoppingRunTotals["bySupplier"][number]>();
  let estimatedTotalCost = 0;

  for (const row of rows) {
    const lineEstimated =
      row.include && row.estimatedUnitCost != null ? row.plannedQty * Math.max(0, row.estimatedUnitCost) : 0;
    if (row.include) estimatedTotalCost += lineEstimated;

    const propKey = row.propertyId;
    if (!byPropertyMap.has(propKey)) {
      byPropertyMap.set(propKey, {
        propertyId: row.propertyId,
        propertyName: row.propertyName,
        suburb: row.suburb,
        lineCount: 0,
        plannedUnits: 0,
        estimatedCost: 0,
        emergencyCount: 0,
      });
    }
    const prop = byPropertyMap.get(propKey)!;
    prop.lineCount += 1;
    if (row.include) {
      prop.plannedUnits += row.plannedQty;
      prop.estimatedCost += lineEstimated;
    }
    if (row.priority === "Emergency") prop.emergencyCount += 1;

    const supplierKey = `${row.category}||${row.supplier ?? "Unknown"}`;
    if (!bySupplierMap.has(supplierKey)) {
      bySupplierMap.set(supplierKey, {
        supplier: row.supplier ?? "Unknown",
        category: row.category,
        lineCount: 0,
        plannedUnits: 0,
        estimatedCost: 0,
      });
    }
    const sup = bySupplierMap.get(supplierKey)!;
    sup.lineCount += 1;
    if (row.include) {
      sup.plannedUnits += row.plannedQty;
      sup.estimatedCost += lineEstimated;
    }
  }

  return {
    lineCount: rows.length,
    includedLineCount: includedRows.length,
    purchasedLineCount: rows.filter((row) => row.purchased).length,
    totalNeededUnits: rows.reduce((sum, row) => sum + Math.max(0, row.needed), 0),
    plannedUnits: includedRows.reduce((sum, row) => sum + Math.max(0, row.plannedQty), 0),
    estimatedTotalCost,
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

export async function saveShoppingRunForOwner(input: {
  id?: string;
  name: string;
  status: ShoppingRunStatus;
  ownerScope: ShoppingRunOwnerScope;
  ownerUserId: string;
  clientId?: string | null;
  planningScope: string;
  rows: ShoppingRunRow[];
}) {
  const store = await readStore();
  const now = new Date().toISOString();
  const totals = computeShoppingRunTotals(input.rows);

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
      totals,
      updatedAt: now,
    };
    await writeStore(store);
    return store.runs[existingIndex];
  }

  const created: ShoppingRunRecord = {
    id: randomUUID(),
    name: input.name,
    status: input.status,
    ownerScope: input.ownerScope,
    ownerUserId: input.ownerUserId,
    clientId: input.clientId ?? null,
    planningScope: input.planningScope || "all",
    rows: input.rows,
    totals,
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

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

export function buildShoppingRunHtml(input: {
  companyName: string;
  logoUrl?: string;
  title?: string;
  run: ShoppingRunRecord;
}) {
  const logoUrl = input.logoUrl?.trim() || "";
  const totals = input.run.totals;
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
              <span>Est. $${prop.estimatedCost.toFixed(2)}</span>
            </div>
          </div>
          <table>
            <thead>
              <tr>
                <th>Buy</th>
                <th>Item</th>
                <th>Supplier</th>
                <th>On hand</th>
                <th>Need</th>
                <th>Plan</th>
                <th>Priority</th>
                <th>Purchased</th>
                <th>Est. Cost</th>
                <th>Notes</th>
              </tr>
            </thead>
            <tbody>
              ${lines
                .map((line) => {
                  const est = line.include && line.estimatedUnitCost != null ? line.plannedQty * line.estimatedUnitCost : 0;
                  return `
                    <tr>
                      <td>${line.include ? "☑" : "☐"}</td>
                      <td>${escapeHtml(line.itemName)}<div class="sub">${escapeHtml(line.category)}</div></td>
                      <td>${escapeHtml(line.supplier ?? "Unknown")}</td>
                      <td class="right">${line.onHand}</td>
                      <td class="right">${line.needed}</td>
                      <td class="right">${line.include ? line.plannedQty : 0} ${escapeHtml(line.unit)}</td>
                      <td>${escapeHtml(line.priority ?? "-")}</td>
                      <td>${line.purchased ? "Yes" : "No"}</td>
                      <td class="right">${line.estimatedUnitCost != null ? `$${est.toFixed(2)}` : "-"}</td>
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
        <span class="chip">Estimated Total: $${totals.estimatedTotalCost.toFixed(2)}</span>
        <span class="chip">Planned Units: ${totals.plannedUnits}</span>
      </div>
      <div class="summary">
        <div class="tile"><div class="label">Lines</div><div class="value">${totals.lineCount}</div></div>
        <div class="tile"><div class="label">Included</div><div class="value">${totals.includedLineCount}</div></div>
        <div class="tile"><div class="label">Purchased</div><div class="value">${totals.purchasedLineCount}</div></div>
        <div class="tile"><div class="label">Est. Cost</div><div class="value">$${totals.estimatedTotalCost.toFixed(2)}</div></div>
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
