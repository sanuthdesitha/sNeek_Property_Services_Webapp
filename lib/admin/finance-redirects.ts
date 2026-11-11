/**
 * Where the old Money entries land on Invoices and pay. Unrelated query
 * parameters are carried across; the old page's own `tab` is replaced by the
 * merged page's tab, since it named a tab of a page that no longer exists.
 */
export function financeTabRedirect(
  tab: "payroll" | "cleaner-invoices",
  searchParams?: Record<string, string | string[] | undefined>,
): string {
  const params = new URLSearchParams();
  params.set("tab", tab);
  for (const [key, value] of Object.entries(searchParams ?? {})) {
    if (key === "tab" || value === undefined) continue;
    for (const item of Array.isArray(value) ? value : [value]) params.append(key, item);
  }
  return `/v2/admin/finance?${params.toString()}`;
}
