/** Per-tab navigation preferences. No form submissions, credentials or records. */
export const VIEW_MEMORY_PREFIX = "sneek:view-memory:v2:";
export const VIEW_QUERY_KEYS = new Set([
  "tab",
  "view",
  "section",
  "step",
  "page",
  "q",
  "search",
  "query",
  "sort",
  "order",
  "dir",
  "status",
  "statusGroup",
  "statusChip",
  "type",
  "jobType",
  "scope",
  "dateScope",
  "dateFrom",
  "dateTo",
  "from",
  "to",
  "start",
  "end",
  "date",
  "month",
  "week",
  "year",
  "clientId",
  "propertyId",
  "cleanerId",
  "assignee",
  "category",
  "filter",
  "invoiced",
  "density",
  "columns",
  "jobsState",
  "archived",
]);

type MemoryBoot = { scope: string; resetHref?: string };
let boot: MemoryBoot | undefined;

export function navigationScope(): string {
  return typeof document === "undefined"
    ? ""
    : (document.body?.dataset.viewScope ?? "anonymous");
}

export function initializeViewMemory(): MemoryBoot {
  const scope = navigationScope();
  if (boot?.scope === scope) return boot;
  boot = { scope };
  if (typeof window === "undefined") return boot;
  const type = (
    performance.getEntriesByType?.("navigation")[0] as
      | PerformanceNavigationTiming
      | undefined
  )?.type;
  if (type === "reload") {
    try {
      const prefix = `${VIEW_MEMORY_PREFIX}${scope}:`;
      for (const key of Object.keys(sessionStorage))
        if (key.startsWith(prefix)) sessionStorage.removeItem(key);
    } catch {
      /* Storage restrictions must not break navigation. */
    }
    const url = new URL(window.location.href);
    if (isPortalPath(url.pathname)) {
      for (const key of Array.from(VIEW_QUERY_KEYS))
        url.searchParams.delete(key);
      const href = url.pathname + url.search + url.hash;
      if (
        href !==
        window.location.pathname + window.location.search + window.location.hash
      ) {
        boot.resetHref = href;
        window.history.replaceState(window.history.state, "", href);
      }
    }
  }
  return boot;
}

export function isPortalPath(pathname: string): boolean {
  const path = pathname.replace(/^\/_accounts\/[a-f0-9]{32}(?=\/)/, "");
  return /^\/(?:v2\/)?(?:admin|cleaner|client|laundry|qa|maintenance)(?:\/|$)/.test(
    path,
  );
}

/** The pathname view memory keys on: without the retained-account prefix. */
function memoryPath(pathname: string): string {
  return pathname.replace(/^\/_accounts\/[a-f0-9]{32}(?=\/)/, "");
}

export function viewMemoryKey(pathname: string, key: string): string {
  return `${VIEW_MEMORY_PREFIX}${initializeViewMemory().scope}:${memoryPath(pathname)}:${key}`;
}

/**
 * The page whose view the viewer has just chosen with a bare link (see
 * rememberChosenView). While set, the pagehide save must not put the view
 * being left back into memory; the provider clears it once the navigation
 * has landed.
 */
let chosenPath: string | null = null;

/**
 * A bare link (no query) to the page that is already open is the viewer
 * choosing that page's default view: the first tab of a record page whose
 * default is the bare URL ("Timeline" on the job page), or "clear filters".
 * It is never a return to the page, so the remembered view must not be put
 * back on it. Records the choice as the page's view and returns true; returns
 * false for anything else (another page, a link that carries a query, another
 * origin), which keeps the normal return-to-last-view behaviour.
 */
export function rememberChosenView(input: string): boolean {
  if (typeof window === "undefined") return false;
  initializeViewMemory();
  try {
    const url = new URL(input, window.location.href);
    if (url.origin !== window.location.origin || !isPortalPath(url.pathname)) return false;
    if (memoryPath(url.pathname) !== memoryPath(window.location.pathname)) return false;
    if (url.search !== "") return false;
    chosenPath = memoryPath(url.pathname);
    sessionStorage.setItem(viewMemoryKey(url.pathname, "@query"), JSON.stringify(""));
    return true;
  } catch {
    return false;
  }
}

/** The chosen view has landed: later saves record the page as it is again. */
export function settleChosenView(): void {
  chosenPath = null;
}

export function rememberedHref(input: string): string {
  if (typeof window === "undefined") return input;
  initializeViewMemory();
  try {
    const url = new URL(input, window.location.href);
    if (url.origin !== window.location.origin || !isPortalPath(url.pathname))
      return input;
    if (
      Array.from(url.searchParams.keys()).some((key) =>
        VIEW_QUERY_KEYS.has(key),
      )
    )
      return input;
    const raw = sessionStorage.getItem(viewMemoryKey(url.pathname, "@query"));
    if (!raw) return input;
    const saved = new URLSearchParams(JSON.parse(raw));
    for (const [key, value] of Array.from(saved.entries()))
      if (VIEW_QUERY_KEYS.has(key)) url.searchParams.append(key, value);
    return url.pathname + url.search + url.hash;
  } catch {
    return input;
  }
}

export function rememberCurrentView(): void {
  if (typeof window === "undefined" || !isPortalPath(window.location.pathname))
    return;
  // Leaving a page for a view chosen on it: the choice is already recorded.
  if (chosenPath !== null && chosenPath === memoryPath(window.location.pathname))
    return;
  try {
    const query = new URLSearchParams();
    for (const [key, value] of Array.from(
      new URLSearchParams(window.location.search).entries(),
    )) {
      if (VIEW_QUERY_KEYS.has(key)) query.append(key, value);
    }
    sessionStorage.setItem(
      viewMemoryKey(window.location.pathname, "@query"),
      JSON.stringify(query.toString()),
    );
  } catch {
    /* Optional preference storage. */
  }
}
