/**
 * Where a signed-in person lands when a PAGE refuses their role.
 *
 * A role guard that throws inside a page render surfaces as "Application
 * error: a server-side exception has occurred". That is the wrong message for
 * someone who is simply not allowed here, and it looks like a broken app.
 * API routes keep throwing: their handlers turn the error into a 403 response.
 */
export const REQUEST_PATH_HEADER = "x-sneek-request-path";

/** Returns the page to redirect to, or null when the caller must throw (API). */
export function pageDenialDestination(requestPath: string | null | undefined): string | null {
  if (!requestPath) return null;
  const pathname = requestPath.split("?")[0];
  if (pathname.startsWith("/api/")) return null;
  // Never redirect a denial page to itself.
  if (pathname === "/unauthorized" || pathname.endsWith("/access-denied")) return null;
  if (pathname === "/v2/admin" || pathname.startsWith("/v2/admin/")) {
    return "/v2/admin/access-denied?reason=role";
  }
  return "/unauthorized";
}
