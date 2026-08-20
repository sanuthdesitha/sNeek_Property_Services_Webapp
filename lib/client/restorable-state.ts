/**
 * Page state that survives leaving and coming back — "back as rewind".
 *
 * Filters, tabs, search text and expanded rows live in component state, so
 * navigating away destroys them. Coming back to the admin jobs list meant
 * re-picking the date range, the status chip and the cleaner every single time,
 * and the deeper the page the more work the back button threw away.
 *
 * WHY sessionStorage rather than the URL: much of this state is not worth a
 * shareable link (which row is expanded), some of it should not be in a link at
 * all, and the router owns the URL. sessionStorage is scoped to the tab, so
 * closing it forgets everything — the right lifetime for "where I was", which
 * is a fact about this browsing session and not about the user.
 *
 * WHY keyed by pathname: two pages that both track `filters` must not read each
 * other's. The dynamic segment is kept, so job A and job B remember separately.
 *
 * Every operation is wrapped: sessionStorage throws in private-mode Safari and
 * when the quota is full, and losing a filter is never worth breaking a page.
 */

const PREFIX = "sneek:page-state";

function storageKey(pathname: string, key: string): string {
  return `${PREFIX}:${pathname}:${key}`;
}

export function readRestorable<T>(pathname: string, key: string): T | undefined {
  if (typeof window === "undefined") return undefined;
  try {
    const raw = window.sessionStorage.getItem(storageKey(pathname, key));
    if (raw === null) return undefined;
    return JSON.parse(raw) as T;
  } catch {
    // Corrupt or unreadable: fall back to the caller's initial value rather
    // than surfacing an error about a filter.
    return undefined;
  }
}

export function writeRestorable(pathname: string, key: string, value: unknown): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(storageKey(pathname, key), JSON.stringify(value));
  } catch {
    // Quota or private mode. The page keeps working; it just will not rewind.
  }
}

export function clearRestorable(pathname: string, key: string): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.removeItem(storageKey(pathname, key));
  } catch {
    // Nothing to do — the value is already unreachable.
  }
}

/**
 * Forget every stored value for a pathname.
 *
 * For a "reset filters" control: clearing the state without clearing the store
 * would restore the old filters on the next visit, which reads as the reset
 * having silently failed.
 */
export function clearRestorablePath(pathname: string): void {
  if (typeof window === "undefined") return;
  try {
    const prefix = `${PREFIX}:${pathname}:`;
    const doomed: string[] = [];
    for (let i = 0; i < window.sessionStorage.length; i++) {
      const key = window.sessionStorage.key(i);
      if (key && key.startsWith(prefix)) doomed.push(key);
    }
    // Collected first: removing during the walk shifts the indices.
    for (const key of doomed) window.sessionStorage.removeItem(key);
  } catch {
    // Same reasoning as above.
  }
}

/**
 * Merge a stored value onto the initial one.
 *
 * A stored object from an older deploy can be missing keys the page now
 * expects, or carry keys it has dropped. Spreading over the initial value means
 * a new filter gets its default instead of `undefined`, which would otherwise
 * reach a `<select>` as an uncontrolled value.
 */
export function mergeRestorable<T>(initial: T, stored: unknown): T {
  if (stored === undefined || stored === null) return initial;
  if (
    typeof initial === "object" &&
    initial !== null &&
    !Array.isArray(initial) &&
    typeof stored === "object" &&
    !Array.isArray(stored)
  ) {
    return { ...(initial as object), ...(stored as object) } as T;
  }
  // Primitives and arrays are replaced wholesale — merging them has no meaning,
  // and a stored value of the wrong type falls back to the initial.
  if (Array.isArray(initial) && Array.isArray(stored)) return stored as T;
  return typeof stored === typeof initial ? (stored as T) : initial;
}
