/** Non-secret account context. Credentials stay in separate HttpOnly cookies. */
export const ACCOUNT_PATH_PREFIX = "/_accounts/";
export function readAccountPath(pathname: string): { contextId: string; pathname: string } | null {
  const match = /^\/_accounts\/([a-f0-9]{32})(\/.*)$/.exec(pathname);
  if (!match || match[2].startsWith("//") || /%(?:2f|5c|2e)/i.test(match[2]) || match[2].includes("\\") || match[2].startsWith(ACCOUNT_PATH_PREFIX)) return null;
  return { contextId: match[1], pathname: match[2] };
}

/** Bind once when a tab starts. Never consult a mutable global "active account". */
export function bindAccountUrl(contextId: string, origin: string) {
  if (!/^[a-f0-9]{32}$/.test(contextId)) throw new Error("Invalid account context");
  const expectedOrigin = new URL(origin).origin;
  return (input: string): string => {
    const url = new URL(input, expectedOrigin);
    if (url.origin !== expectedOrigin) throw new Error("Account requests must stay on this origin");
    const scoped = readAccountPath(url.pathname);
    if (scoped) {
      if (scoped.contextId !== contextId) throw new Error("Request belongs to another account");
      return url.pathname + url.search + url.hash;
    }
    if (url.pathname.startsWith(ACCOUNT_PATH_PREFIX)) throw new Error("Invalid account path");
    return `${ACCOUNT_PATH_PREFIX}${contextId}${url.pathname}${url.search}${url.hash}`;
  };
}
