/**
 * Where the old live map URL goes now.
 *
 * Live ops (/v2/admin/ops) now shows the same map with the
 * live list beside it, so today's map redirects there, keeping any other
 * parameters. A different `?date=` was a planning view of that day's routes:
 * it goes to the route map for that date, which keeps working.
 */
export function opsMapRedirectTarget(searchParams: Record<string, string | string[] | undefined>, todayKey: string): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(searchParams)) {
    for (const entry of Array.isArray(value) ? value : value === undefined ? [] : [value]) params.append(key, entry);
  }
  const date = params.get("date");
  if (date && /^\d{4}-\d{2}-\d{2}$/.test(date) && date !== todayKey) {
    return `/v2/admin/jobs/route-map?${params.toString()}`;
  }
  params.delete("date");
  const query = params.toString();
  return query ? `/v2/admin/ops?${query}` : "/v2/admin/ops";
}

