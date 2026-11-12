/**
 * The Suppliers list read model (Inventory › Suppliers): stock suppliers (the
 * AppSetting catalog) and laundry partners (LaundrySupplier rows) in one list.
 * A laundry partner linked to a stock supplier (`LaundrySupplier.stockSupplierId`)
 * is the same business and shows as one row with both types. PLAIN module:
 * shared by the route and the client screen.
 */

export type StockSupplierRecord = {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  website: string | null;
  defaultLeadDays: number;
  categories: string[];
  notes: string | null;
  isActive: boolean;
};

export type LaundryTeamMember = { id: string; name: string | null; email: string; isActive: boolean };

export type LaundryPartnerRecord = {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  address: string | null;
  pricePerKg: number | null;
  /** Average turnaround in hours, as the laundry screens use it. Null = not recorded. */
  avgTurnaround: number | null;
  reliabilityScore: number | null;
  notes: string | null;
  isActive: boolean;
  stockSupplierId: string | null;
  team: LaundryTeamMember[];
  /** Runs on record for this partner (any status). */
  runCount: number;
};

export type SupplierDirectoryKind = "STOCK" | "LAUNDRY" | "BOTH";

export type SupplierDirectoryRow = {
  /** Stable row key: the stock supplier id when there is one, else `laundry:<id>`. */
  key: string;
  kind: SupplierDirectoryKind;
  name: string;
  stock: StockSupplierRecord | null;
  laundry: LaundryPartnerRecord | null;
};

/** A LAUNDRY portal account the partner editor can put on a team. */
export type LaundryUserOption = { id: string; name: string | null; email: string; isActive: boolean; laundrySupplierId: string | null };

export type SupplierDirectoryResponse = {
  rows: SupplierDirectoryRow[];
  laundryUsers: LaundryUserOption[];
  /** A linked stock supplier id that no longer exists in the catalog (shown, never silently dropped). */
  danglingLinks: Array<{ laundrySupplierId: string; stockSupplierId: string }>;
};

export const SUPPLIER_KIND_LABELS: Record<SupplierDirectoryKind, string> = {
  STOCK: "Stock supplier",
  LAUNDRY: "Laundry partner",
  BOTH: "Stock supplier · Laundry partner",
};

export function laundryRunsHref(laundrySupplierId: string): string {
  return `/v2/admin/laundry?supplier=${encodeURIComponent(laundrySupplierId)}`;
}

/**
 * Merge the two lists. PURE. Linked pairs become one row; a link to a stock
 * supplier that is gone keeps the laundry partner as its own row and reports
 * the link as dangling.
 */
export function buildSupplierDirectory(stock: StockSupplierRecord[], laundry: LaundryPartnerRecord[]): Pick<SupplierDirectoryResponse, "rows" | "danglingLinks"> {
  const stockById = new Map(stock.map((row) => [row.id, row]));
  const laundryByStock = new Map<string, LaundryPartnerRecord>();
  const danglingLinks: SupplierDirectoryResponse["danglingLinks"] = [];
  const rows: SupplierDirectoryRow[] = [];
  for (const partner of laundry) {
    if (partner.stockSupplierId && stockById.has(partner.stockSupplierId)) {
      laundryByStock.set(partner.stockSupplierId, partner);
      continue;
    }
    if (partner.stockSupplierId) danglingLinks.push({ laundrySupplierId: partner.id, stockSupplierId: partner.stockSupplierId });
    rows.push({ key: `laundry:${partner.id}`, kind: "LAUNDRY", name: partner.name, stock: null, laundry: partner });
  }
  for (const supplier of stock) {
    const partner = laundryByStock.get(supplier.id) ?? null;
    rows.push({ key: supplier.id, kind: partner ? "BOTH" : "STOCK", name: supplier.name, stock: supplier, laundry: partner });
  }
  rows.sort((a, b) => a.name.localeCompare(b.name) || a.key.localeCompare(b.key));
  return { rows, danglingLinks };
}
