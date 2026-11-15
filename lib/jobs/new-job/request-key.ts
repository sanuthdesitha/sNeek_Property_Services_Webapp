/**
 * Request keys for the New job page (plain module, shared by the route and the
 * page). One key per unsaved job, kept with the browser draft until the job
 * is created, so a retry after a dropped connection returns the job the first
 * attempt made instead of creating a second one. Several dates use one batch
 * key with the day appended, so a retry creates only the missing days.
 */
const KEY_PATTERN = /^[A-Za-z0-9_-]{8,80}(?::\d{4}-\d{2}-\d{2})?$/;

export function isValidIdempotencyKey(value: string): boolean {
  return KEY_PATTERN.test(value);
}

/** A fresh key (browser or server). */
export function newRequestKey(): string {
  const cryptoRef = globalThis.crypto;
  if (cryptoRef && typeof cryptoRef.randomUUID === "function") return cryptoRef.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

/** The key for one day of a several-dates batch. */
export function dayRequestKey(batchKey: string, dayKey: string): string {
  return `${batchKey}:${dayKey}`;
}
