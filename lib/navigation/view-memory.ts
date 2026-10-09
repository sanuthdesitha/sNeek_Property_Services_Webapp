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

export function viewMemoryKey(pathname: string, key: string): string {
  const path = pathname.replace(/^\/_accounts\/[a-f0-9]{32}(?=\/)/, "");
  return `${VIEW_MEMORY_PREFIX}${initializeViewMemory().scope}:${path}:${key}`;
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
