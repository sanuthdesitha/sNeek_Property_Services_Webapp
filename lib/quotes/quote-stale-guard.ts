/**
 * The quote PATCH's stale-write guard (owner decision 2026-11-13, mirroring
 * the invoice editor's Wave D guard). A caller that read the quote at
 * `expectedUpdatedAt` may only write while the stored row is still that
 * version; otherwise it gets 409 with the current token and nothing is
 * written, so the quote page's autosave can never silently overwrite another
 * tab, the pipeline, a client's add-on request or a discount change.
 *
 * Callers that send no token keep the old behaviour (the pipeline, the v1
 * pages, the mobile app). A token that cannot be read is treated as stale,
 * never as "no token". Plain module: the browser reads the code constant.
 */

export const STALE_QUOTE_CODE = "STALE_QUOTE";
export const STALE_QUOTE_REFUSAL =
  "This quote was changed somewhere else since you opened it. Reload their version, or keep your edits and try again.";

export type StaleQuoteBody = { error: string; code: typeof STALE_QUOTE_CODE; currentUpdatedAt: string };

/** True when a caller's expectation does not match the stored version (an absent expectation never does). */
export function isStaleQuoteWrite(storedUpdatedAt: Date, expectedUpdatedAt: string | undefined): boolean {
  if (expectedUpdatedAt === undefined) return false;
  // Compared as epoch milliseconds so "+10:00" and "Z" spellings of one instant agree.
  const expected = new Date(expectedUpdatedAt).getTime();
  return !(Number.isFinite(expected) && expected === storedUpdatedAt.getTime());
}

export function staleQuoteBody(storedUpdatedAt: Date): StaleQuoteBody {
  return { error: STALE_QUOTE_REFUSAL, code: STALE_QUOTE_CODE, currentUpdatedAt: storedUpdatedAt.toISOString() };
}
