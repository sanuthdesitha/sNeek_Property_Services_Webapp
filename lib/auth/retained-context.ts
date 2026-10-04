import "server-only";
import { headers, cookies } from "next/headers";
import { resolveRetainedAccount, type RetainedAccountSecrets } from "./retained-accounts";
export const RETAINED_CONTEXT_HEADER = "x-sneek-retained-context";
const cookiePrefix = process.env.NODE_ENV === "production" ? "__Host-" : "";
export const RETAINED_BROWSER_COOKIE = `${cookiePrefix}sneek.retained-browser`;
export const retainedSecretCookie = (id: string) => `${cookiePrefix}sneek.retained-secret.${id}`;
export function retainedContextId() {
  try { const id = headers().get(RETAINED_CONTEXT_HEADER); return id && /^[a-f0-9]{32}$/.test(id) ? id : null; } catch { return null; }
}
export function retainedRequestSecrets(contextId = retainedContextId()): RetainedAccountSecrets {
  if (!contextId) throw new Error("UNAUTHORIZED");
  return { contextId, browserSecret: cookies().get(RETAINED_BROWSER_COOKIE)?.value ?? "", contextSecret: cookies().get(retainedSecretCookie(contextId))?.value ?? "" };
}
export async function retainedRequestSession() { return resolveRetainedAccount(retainedRequestSecrets()); }
