/**
 * Build a redirect target that keeps the old URL's query string, so a retired
 * route (a bookmark, an emailed link) lands on its replacement with the same
 * filters. Pure; safe on the server and in tests.
 */
export type RouteSearchParams = Record<string, string | string[] | undefined>;

export function withQuery(target: string, searchParams: RouteSearchParams | undefined): string {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(searchParams ?? {})) {
    if (typeof value === "string") query.append(key, value);
    else if (Array.isArray(value)) for (const item of value) query.append(key, item);
  }
  const text = query.toString();
  if (!text) return target;
  return `${target}${target.includes("?") ? "&" : "?"}${text}`;
}
