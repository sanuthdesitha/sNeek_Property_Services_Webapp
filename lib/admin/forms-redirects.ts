/**
 * Where the old Forms-area pages land on the merged Forms library
 * (/v2/admin/forms). Unrelated query parameters are carried across, so deep
 * links keep their meaning (the stats page's `templateId` and `weeks` still
 * choose the form and range). An old page's own `tab` named a tab of a page
 * that no longer exists, so it is translated into the library's `view`.
 */
export type FormsLibraryTab = "forms" | "qa" | "blocks" | "messages" | "stats";

type SearchParams = Record<string, string | string[] | undefined> | undefined;

function firstValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/** The Templates page's `tab` (notifications | messages) becomes the Message templates `view`. */
function messagesView(searchParams: SearchParams): string {
  return firstValue(searchParams?.tab) === "messages" ? "messages" : "notifications";
}

export function formsTabRedirect(tab: Exclude<FormsLibraryTab, "forms">, searchParams?: SearchParams): string {
  const params = new URLSearchParams();
  params.set("tab", tab);
  if (tab === "messages") params.set("view", messagesView(searchParams));
  if (tab === "blocks") params.set("view", "library");
  for (const [key, value] of Object.entries(searchParams ?? {})) {
    if (key === "tab" || key === "view" || value === undefined) continue;
    for (const item of Array.isArray(value) ? value : [value]) params.append(key, item);
  }
  return `/v2/admin/forms?${params.toString()}`;
}

const TABS: readonly FormsLibraryTab[] = ["forms", "qa", "blocks", "messages", "stats"];

/**
 * The library tab a `?tab=` value opens. Old values keep working: the forms
 * page's `templates` is Job forms and its `checklists` (the per-service
 * checklists editor) is a view of Checklist blocks.
 */
export function resolveFormsTab(raw: string | undefined): { tab: FormsLibraryTab; legacyChecklists: boolean } {
  if (raw === "templates") return { tab: "forms", legacyChecklists: false };
  if (raw === "checklists") return { tab: "blocks", legacyChecklists: true };
  if (raw && (TABS as readonly string[]).includes(raw)) return { tab: raw as FormsLibraryTab, legacyChecklists: false };
  return { tab: "forms", legacyChecklists: false };
}
