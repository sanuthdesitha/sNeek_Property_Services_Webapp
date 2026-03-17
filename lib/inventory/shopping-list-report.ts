import { db } from "@/lib/db";

export interface ShoppingListItemInfo {
  id: string;
  name: string;
  sku: string | null;
  category: string;
  unit: string;
  supplier: string | null;
}

export interface ShoppingListRow {
  propertyId: string;
  propertyName: string;
  suburb: string;
  item: ShoppingListItemInfo;
  onHand: number;
  parLevel: number;
  reorderThreshold: number;
  needed: number;
}

export type ShoppingListGrouped = Record<string, ShoppingListRow[]>;

export async function getShoppingListRows(input?: { scope?: string; propertyIds?: string[] }): Promise<ShoppingListRow[]> {
  const scope = input?.scope ?? "all";
  const propertyId = scope !== "all" ? scope : undefined;
  const propertyIds = Array.isArray(input?.propertyIds) ? input?.propertyIds.filter(Boolean) : [];
  const stocks = await db.propertyStock.findMany({
    where: {
      ...(propertyId ? { propertyId } : {}),
      ...(propertyIds.length > 0 ? { propertyId: { in: propertyIds } } : {}),
    },
    include: {
      item: true,
      property: { select: { id: true, name: true, suburb: true } },
    },
    orderBy: [{ property: { name: "asc" } }, { item: { category: "asc" } }, { item: { name: "asc" } }],
  });

  const rows: ShoppingListRow[] = [];
  for (const stock of stocks) {
    if (stock.onHand > stock.reorderThreshold) continue;
    rows.push({
      propertyId: stock.property.id,
      propertyName: stock.property.name,
      suburb: stock.property.suburb,
      item: {
        id: stock.item.id,
        name: stock.item.name,
        sku: stock.item.sku,
        category: stock.item.category,
        unit: stock.item.unit,
        supplier: stock.item.supplier,
      },
      onHand: stock.onHand,
      parLevel: stock.parLevel,
      reorderThreshold: stock.reorderThreshold,
      needed: Math.max(0, stock.parLevel - stock.onHand),
    });
  }
  return rows;
}

export function groupShoppingListRows(rows: ShoppingListRow[]): ShoppingListGrouped {
  const grouped: ShoppingListGrouped = {};
  for (const row of rows) {
    const key = `${row.item.category}||${row.item.supplier ?? "Unknown"}`;
    if (!grouped[key]) grouped[key] = [];
    grouped[key].push(row);
  }
  return grouped;
}

export async function getShoppingListGrouped(scope: string): Promise<ShoppingListGrouped> {
  const rows = await getShoppingListRows({ scope });
  const grouped = groupShoppingListRows(rows);

  return grouped;
}

export function summarizeShoppingList(grouped: ShoppingListGrouped) {
  const groups = Object.entries(grouped);
  const rowCount = groups.reduce((sum, [, rows]) => sum + rows.length, 0);
  const totalUnitsNeeded = groups.reduce((sum, [, rows]) => sum + rows.reduce((s, row) => s + row.needed, 0), 0);
  const properties = new Set(
    groups.flatMap(([, rows]) => rows.map((row) => row.propertyId))
  ).size;
  return {
    groupCount: groups.length,
    rowCount,
    totalUnitsNeeded,
    properties,
  };
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

export function buildShoppingListHtml(input: {
  companyName: string;
  logoUrl?: string;
  scopeLabel: string;
  generatedAt?: Date;
  grouped: ShoppingListGrouped;
  recipientName?: string | null;
}) {
  const generatedAt = input.generatedAt ?? new Date();
  const summary = summarizeShoppingList(input.grouped);
  const groupedEntries = Object.entries(input.grouped);
  const logoUrl = input.logoUrl?.trim() || "";

  const groupsHtml = groupedEntries
    .map(([groupKey, rows]) => {
      const [category, supplier] = groupKey.split("||");
      const rowsHtml = rows
        .map(
          (row) => `
            <tr>
              <td>${escapeHtml(row.propertyName)}</td>
              <td>${escapeHtml(row.suburb)}</td>
              <td>${escapeHtml(row.item.name)}</td>
              <td class="right">${row.onHand}</td>
              <td class="right">${row.parLevel}</td>
              <td class="right need">${row.needed} ${escapeHtml(row.item.unit)}</td>
            </tr>
          `
        )
        .join("");

      return `
        <section class="group">
          <div class="group-head">
            <h3>${escapeHtml(category)} | ${escapeHtml(supplier || "Unknown")}</h3>
            <span>${rows.length} item${rows.length === 1 ? "" : "s"}</span>
          </div>
          <table>
            <thead>
              <tr>
                <th>Property</th>
                <th>Suburb</th>
                <th>Item</th>
                <th class="right">On Hand</th>
                <th class="right">Par</th>
                <th class="right">Need</th>
              </tr>
            </thead>
            <tbody>${rowsHtml}</tbody>
          </table>
        </section>
      `;
    })
    .join("");

  return `
    <!doctype html>
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <title>Shopping List</title>
        <style>
          body { font-family: Arial, sans-serif; color: #111827; margin: 20px; }
          .brand { display:flex; align-items:center; gap:12px; }
          .brand img { width:48px; height:48px; object-fit:contain; border-radius:10px; border:1px solid #e5e7eb; padding:4px; background:#fff; }
          h1 { margin: 0 0 4px; font-size: 24px; }
          .sub { margin: 0; color: #4b5563; font-size: 12px; }
          .meta { margin-top: 8px; font-size: 12px; color: #4b5563; }
          .summary { margin-top: 14px; display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; }
          .tile { border: 1px solid #e5e7eb; border-radius: 8px; padding: 8px; }
          .tile .label { font-size: 10px; text-transform: uppercase; color: #6b7280; }
          .tile .value { font-size: 16px; font-weight: 700; margin-top: 2px; }
          .group { margin-top: 18px; }
          .group-head { display: flex; align-items: baseline; justify-content: space-between; margin-bottom: 8px; }
          .group-head h3 { margin: 0; font-size: 14px; }
          .group-head span { color: #6b7280; font-size: 11px; }
          table { width: 100%; border-collapse: collapse; font-size: 12px; }
          th { text-align: left; border-bottom: 2px solid #d1d5db; padding: 6px; }
          td { border-bottom: 1px solid #e5e7eb; padding: 6px; }
          .right { text-align: right; white-space: nowrap; }
          .need { color: #b91c1c; font-weight: 700; }
          .empty { margin-top: 18px; padding: 14px; border: 1px dashed #d1d5db; border-radius: 8px; color: #6b7280; }
        </style>
      </head>
      <body>
        <div class="brand">
          ${logoUrl ? `<img src="${escapeHtml(logoUrl)}" alt="${escapeHtml(input.companyName)} logo" />` : ""}
          <h1>${escapeHtml(input.companyName)} - Inventory Shopping List</h1>
        </div>
        <p class="sub">Scope: ${escapeHtml(input.scopeLabel)}</p>
        <p class="meta">Generated: ${generatedAt.toLocaleString("en-AU")}</p>
        ${
          input.recipientName
            ? `<p class="meta">Prepared for: ${escapeHtml(input.recipientName)}</p>`
            : ""
        }
        <div class="summary">
          <div class="tile"><div class="label">Groups</div><div class="value">${summary.groupCount}</div></div>
          <div class="tile"><div class="label">Lines</div><div class="value">${summary.rowCount}</div></div>
          <div class="tile"><div class="label">Properties</div><div class="value">${summary.properties}</div></div>
          <div class="tile"><div class="label">Units Needed</div><div class="value">${summary.totalUnitsNeeded}</div></div>
        </div>
        ${
          groupedEntries.length > 0
            ? groupsHtml
            : `<div class="empty">All stock levels are healthy. No items need restocking.</div>`
        }
      </body>
    </html>
  `;
}

export async function renderShoppingListPdf(html: string): Promise<Buffer> {
  const { chromium } = await import("playwright");
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: "networkidle" });
    const pdf = await page.pdf({
      format: "A4",
      printBackground: true,
      margin: { top: "12mm", right: "10mm", bottom: "12mm", left: "10mm" },
    });
    return Buffer.from(pdf);
  } finally {
    await browser.close();
  }
}
