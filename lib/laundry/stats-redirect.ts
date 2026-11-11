/** Where the old /v2/admin/laundry/stats address now goes: the Statistics tab, other parameters kept. */
export function laundryStatsRedirectTarget(searchParams: Record<string, string | string[] | undefined> = {}): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(searchParams)) {
    if (key === "tab" || value === undefined) continue;
    for (const item of Array.isArray(value) ? value : [value]) params.append(key, item);
  }
  params.set("tab", "statistics");
  return `/v2/admin/laundry?${params.toString()}`;
}
