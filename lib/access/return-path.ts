/**
 * The page a person tried to open, carried to the access-denied page as
 * `?from=` (boards "Access denied", 2026-11). Plain module: middleware (edge),
 * server pages, client components and tests all use it.
 *
 * The value is untrusted (anyone can type a URL), so:
 * - only a same-origin PATH is accepted: it starts with one "/", never "//" or
 *   "/\", carries no scheme, host, control character or backslash, and stays
 *   on this origin when resolved;
 * - it is never used as a redirect target. The denial page only names the
 *   area and shows a shortened path; "Back to where you were" uses the
 *   browser's own history, falling back to the person's home;
 * - React escapes it when shown; nothing renders it as HTML.
 */

/** Longest `from` value accepted (anything longer is dropped, not cut). */
export const FROM_PATH_MAX_LENGTH = 512;

const INTERNAL_ORIGIN = "https://denied.invalid";

/** Pages that are themselves the explanation: never a `from`. */
function isDenialPage(pathname: string): boolean {
  return pathname === "/unauthorized" || /\/access-denied\/?$/.test(pathname);
}

/**
 * The validated same-origin path (pathname plus query), or null when the value
 * is missing or could point anywhere else.
 */
export function safeFromPath(raw: string | null | undefined): string | null {
  if (typeof raw !== "string") return null;
  const value = raw.trim();
  if (!value || value.length > FROM_PATH_MAX_LENGTH) return null;
  if (!value.startsWith("/") || value.startsWith("//") || value.startsWith("/\\")) return null;
  // Backslashes, whitespace and control characters are how browsers get
  // talked into treating a "path" as another host.
  if (/[\\\u0000- \u007f]/.test(value)) return null;
  let url: URL;
  try {
    url = new URL(value, INTERNAL_ORIGIN);
  } catch {
    return null;
  }
  if (url.origin !== INTERNAL_ORIGIN) return null;
  if (url.pathname.startsWith("/api/") || isDenialPage(url.pathname)) return null;
  return `${url.pathname}${url.search}`;
}

/** Same rule for a value read from Next's `searchParams` (string, array or absent). */
export function fromSearchParam(value: string | string[] | undefined): string | null {
  return safeFromPath(Array.isArray(value) ? value[0] : value);
}

/** `?from=` for a denial redirect; empty when the path is not acceptable. */
export function fromQuery(path: string | null | undefined): string {
  const safe = safeFromPath(path);
  return safe ? `from=${encodeURIComponent(safe)}` : "";
}

/** Append `from` to a denial destination that may already carry a query. */
export function withFrom(destination: string, path: string | null | undefined): string {
  const query = fromQuery(path);
  if (!query) return destination;
  return `${destination}${destination.includes("?") ? "&" : "?"}${query}`;
}

/** A segment that looks like a record id, a number or a token (never a page word). */
function looksLikeRecord(segment: string): boolean {
  if (segment === "v2") return false;
  return !/^[a-z][a-z-]{0,39}$/.test(segment);
}

/**
 * The path as the page shows it: no query, and every segment from the first
 * record-like one on replaced by "…". The page names the AREA, never a
 * record, and says the same whether or not such a record exists.
 */
export function displayFromPath(path: string | null): string | null {
  const safe = safeFromPath(path);
  if (!safe) return null;
  const pathname = new URL(safe, INTERNAL_ORIGIN).pathname;
  const segments = pathname.split("/").filter(Boolean);
  const shown: string[] = [];
  for (const segment of segments) {
    if (looksLikeRecord(segment)) {
      shown.push("…");
      break;
    }
    shown.push(segment);
  }
  return `/${shown.join("/")}`;
}
