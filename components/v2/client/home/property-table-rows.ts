/**
 * Rows for the desktop "Your properties" table, built on the server from the
 * home data. A column appears only when its data is shared with this viewer
 * (same switches as the page that owns the data); a cell whose read failed says
 * "Unavailable" instead of looking empty. Plain module.
 */
import type { ClientHomeData } from "@/lib/client/home-dashboard";
import type { PropertyColumn, PropertyTableCell, PropertyTableRow } from "@/components/v2/client/home/properties-table";
import { laundryByProperty, lowStock, type LaundryRow, type StockRow } from "@/components/v2/client/home/home-model";

const UNAVAILABLE: PropertyTableCell = { text: "Unavailable", sort: "" };

function dayLabel(day: string): string {
  return new Date(`${day}T00:00:00Z`).toLocaleDateString("en-AU", { timeZone: "UTC", weekday: "short", day: "numeric", month: "short" });
}

export function buildPropertyTable(data: ClientHomeData): { rows: PropertyTableRow[]; columns: PropertyColumn[] } {
  const visibility = data.visibility;
  const columns: PropertyColumn[] = [
    ...(visibility.showJobs ? [{ key: "next" as const, label: "Next clean" }, { key: "report" as const, label: "Last report" }] : []),
    ...(visibility.showInventory ? [{ key: "stock" as const, label: "Stock" }] : []),
    ...(visibility.showLaundryUpdates ? [{ key: "laundry" as const, label: "Laundry" }] : []),
    { key: "cleaner", label: "Preferred cleaner" },
    { key: "open", label: "Open items" },
  ];
  const stock = data.stocks ? lowStock(data.stocks as StockRow[]) : null;
  const laundry = data.laundry ? laundryByProperty(data.laundry as LaundryRow[]) : null;

  const rows = (data.properties ?? []).map((property): PropertyTableRow => {
    const next: PropertyTableCell | null = property.next === "hidden" ? null : property.next
      ? { text: `${dayLabel(property.next.day)}${property.next.startTime ? ` ${property.next.startTime}` : ""}`, sort: `${property.next.day} ${property.next.startTime ?? ""}`, href: `/v2/client/jobs/${property.next.id}` }
      : { text: "None scheduled", sort: "" };
    const report: PropertyTableCell | null = property.last === "hidden" ? null : property.last === "unavailable" ? UNAVAILABLE : property.last
      ? { text: dayLabel(property.last.day), sort: property.last.day, href: property.last.reportId ? `/v2/client/reports?propertyId=${property.id}` : `/v2/client/jobs/${property.last.id}` }
      : { text: "No clean yet", sort: "" };
    const stockEntry = stock?.byProperty.get(property.id);
    const stockCell: PropertyTableCell = !stock ? UNAVAILABLE : !stockEntry ? { text: "Not tracked", sort: "" }
      : stockEntry.low > 0
        ? { text: "", sort: String(1000 - stockEntry.low).padStart(4, "0"), badge: { label: `${stockEntry.low} low`, tone: "warning" } }
        : { text: "", sort: "9999", badge: { label: "Topped up", tone: "success" } };
    const laundryCell: PropertyTableCell = !laundry ? UNAVAILABLE : { text: laundry.get(property.id) ?? "Not scheduled", sort: laundry.get(property.id) ?? "" };
    const cleanerName = data.extras ? data.extras.preferredCleaner.get(property.id) ?? null : undefined;
    const cleaner: PropertyTableCell = cleanerName === undefined ? UNAVAILABLE : { text: cleanerName ?? "None set", sort: cleanerName ?? "" };
    const approvals = property.approvals === "hidden" ? 0 : property.approvals === "unavailable" ? null : property.approvals;
    const cases = data.extras ? data.extras.openCases.get(property.id) ?? 0 : null;
    const openParts = [
      approvals ? `${approvals} approval${approvals === 1 ? "" : "s"}` : null,
      cases ? `${cases} case${cases === 1 ? "" : "s"}` : null,
    ].filter((part): part is string => Boolean(part));
    const open: PropertyTableCell = approvals === null || cases === null ? UNAVAILABLE : openParts.length === 0
      ? { text: "None", sort: "" }
      : { text: "", sort: String(100 - (approvals ?? 0) - cases).padStart(3, "0"), badge: { label: openParts.join(" · "), tone: "warning" } };
    return {
      id: property.id,
      name: property.name,
      suburb: property.suburb,
      cells: { next, report, stock: stockCell, laundry: laundryCell, cleaner, open },
    };
  });
  return { rows, columns };
}
