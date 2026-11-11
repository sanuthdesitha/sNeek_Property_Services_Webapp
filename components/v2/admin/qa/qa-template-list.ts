/**
 * Filter and sort of the QA templates table (job type, scope; sort by job
 * type, scope, name or version). PURE.
 */
export type QaSort = "jobType" | "scope" | "name" | "version";

type Sortable = { name: string; serviceType: string; propertyId: string | null; version: number; property?: { name: string } | null };

export function filterAndSortQaTemplates<T extends Sortable>(
  rows: readonly T[],
  options: { jobType: string; scope: string; sort: QaSort },
): T[] {
  const filtered = rows.filter((row) => {
    if (options.jobType !== "all" && String(row.serviceType) !== options.jobType) return false;
    if (options.scope === "global" && row.propertyId) return false;
    if (options.scope === "property" && !row.propertyId) return false;
    return true;
  });
  const scopeName = (row: T) => (row.propertyId ? row.property?.name ?? row.propertyId : "");
  const compare: Record<QaSort, (a: T, b: T) => number> = {
    jobType: (a, b) => String(a.serviceType).localeCompare(String(b.serviceType)) || scopeName(a).localeCompare(scopeName(b)) || b.version - a.version,
    scope: (a, b) => scopeName(a).localeCompare(scopeName(b)) || String(a.serviceType).localeCompare(String(b.serviceType)),
    name: (a, b) => a.name.localeCompare(b.name),
    version: (a, b) => b.version - a.version,
  };
  return filtered.slice().sort(compare[options.sort]);
}
