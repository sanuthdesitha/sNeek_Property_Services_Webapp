/**
 * Elapsed-time helpers shared by the cleaner job timer and admin live views.
 * All functions are defensive: invalid dates / NaN / negative inputs render
 * as zero instead of crashing the timer UI.
 */

/** Clamp arbitrary input to a safe non-negative integer second count. */
export function safeSeconds(value: unknown): number {
  const numeric = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return 0;
  return Math.floor(numeric);
}

/** "01:23:45" — used by the running job timer. Never returns NaN. */
export function formatDuration(seconds: number): string {
  const total = safeSeconds(seconds);
  const h = Math.floor(total / 3600).toString().padStart(2, "0");
  const m = Math.floor((total % 3600) / 60).toString().padStart(2, "0");
  const s = (total % 60).toString().padStart(2, "0");
  return `${h}:${m}:${s}`;
}

/** "1h 23m" / "45m" — used by admin live views. */
export function formatElapsedShort(seconds: number): string {
  const total = safeSeconds(seconds);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  if (hours <= 0) return `${minutes}m`;
  return `${hours}h ${minutes}m`;
}

/**
 * Seconds elapsed since an ISO timestamp (plus already-banked seconds).
 * Returns just the banked seconds when the timestamp is null/invalid/future,
 * so a corrupt `startedAt` can never produce NaN or a negative timer.
 */
export function elapsedSecondsSince(
  startedAt: string | Date | null | undefined,
  completedSeconds = 0,
  now: number = Date.now()
): number {
  const banked = safeSeconds(completedSeconds);
  if (!startedAt) return banked;
  const startedMs = startedAt instanceof Date ? startedAt.getTime() : new Date(startedAt).getTime();
  if (!Number.isFinite(startedMs)) return banked;
  const active = Math.floor((now - startedMs) / 1000);
  return banked + Math.max(0, active);
}
