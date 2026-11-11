/**
 * Where the classic /admin/forms builder pages land now that the form builder
 * lives in /v2/admin/forms. The template id and every query parameter are
 * carried across, so an old link opens the same form.
 */
type SearchParams = Record<string, string | string[] | undefined> | undefined;

export function queryString(searchParams: SearchParams): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(searchParams ?? {})) {
    if (value === undefined) continue;
    for (const item of Array.isArray(value) ? value : [value]) params.append(key, item);
  }
  const text = params.toString();
  return text ? `?${text}` : "";
}

export function legacyFormEditRedirect(templateId: string, searchParams?: SearchParams): string {
  return `/v2/admin/forms/${encodeURIComponent(templateId)}/edit${queryString(searchParams)}`;
}

export function legacyNewFormRedirect(searchParams?: SearchParams): string {
  return `/v2/admin/forms/new${queryString(searchParams)}`;
}
