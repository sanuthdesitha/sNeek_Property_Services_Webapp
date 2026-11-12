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

/**
 * The classic /admin/forms page (Builder, Checklists and Submissions tabs),
 * retired in Wave E. Its tabs map onto the Forms library:
 *   builder (or none) → Job forms
 *   checklists        → Checklist blocks, per-service checklists
 *   submissions       → Results and stats, Submissions
 * Any other parameter is carried across.
 */
export function legacyFormsPageRedirect(searchParams?: SearchParams): string {
  const raw = searchParams?.tab;
  const tab = Array.isArray(raw) ? raw[0] : raw;
  const params = new URLSearchParams();
  if (tab === "checklists") {
    params.set("tab", "blocks");
    params.set("view", "service");
  } else if (tab === "submissions") {
    params.set("tab", "stats");
    params.set("view", "submissions");
  } else {
    params.set("tab", "forms");
  }
  for (const [key, value] of Object.entries(searchParams ?? {})) {
    if (key === "tab" || key === "view" || value === undefined) continue;
    for (const item of Array.isArray(value) ? value : [value]) params.append(key, item);
  }
  return `/v2/admin/forms?${params.toString()}`;
}
