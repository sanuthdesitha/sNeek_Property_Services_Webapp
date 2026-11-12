/**
 * The configured sales account's NAME for the invoice editor's Xero card
 * (Wave D), read from Xero's chart of accounts when Xero is connected and
 * cached per code for 15 minutes (a failure for 2 minutes), so opening
 * invoices does not call Xero each time. When it cannot be read the card shows
 * the code and "name unavailable" with the reason, never a guess.
 */
import { hasActiveXeroConnection, readXeroAccountName } from "@/lib/xero/client";

const OK_TTL_MS = 15 * 60_000;
const FAIL_TTL_MS = 2 * 60_000;

export type XeroAccountName = { name: string | null; reason: string | null };

type Entry = { value: XeroAccountName; expires: number };
const cache = new Map<string, Entry>();

export function clearXeroAccountNameCache(): void {
  cache.clear();
}

export async function xeroAccountName(code: string, now: number = Date.now()): Promise<XeroAccountName> {
  const cached = cache.get(code);
  if (cached && cached.expires > now) return cached.value;
  let value: XeroAccountName;
  try {
    if (!(await hasActiveXeroConnection())) value = { name: null, reason: "Xero is not connected." };
    else {
      const read = await readXeroAccountName(code);
      value = read.ok ? { name: read.name, reason: null } : { name: null, reason: read.reason };
    }
  } catch (error) {
    value = { name: null, reason: error instanceof Error && error.message ? error.message : "Xero could not be read." };
  }
  cache.set(code, { value, expires: now + (value.name ? OK_TTL_MS : FAIL_TTL_MS) });
  return value;
}
