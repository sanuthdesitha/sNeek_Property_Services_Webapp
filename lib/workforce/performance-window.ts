import "server-only";
/**
 * One performance window (30, 90 or 365 days) with a time limit. A window
 * that takes too long or fails is reported as such, never as an empty set of
 * zeros (board "Workforce" › performance page): the page shows "not worked
 * out" and offers a retry for that window only.
 */
import { getPerformanceMetrics, type PerformanceMetrics } from "./performance";

export const PERFORMANCE_WINDOWS = [30, 90, 365] as const;
export type PerformanceWindowDays = (typeof PERFORMANCE_WINDOWS)[number];

export const PERFORMANCE_WINDOW_TIMEOUT_MS = 12_000;

/** JSON-safe metrics (dates as ISO strings). */
export type SerializedMetrics = Omit<PerformanceMetrics, "windowStart"> & { windowStart: string };

export type PerformanceWindowResult =
  | { status: "ready"; windowDays: PerformanceWindowDays; metrics: SerializedMetrics }
  | { status: "timed_out"; windowDays: PerformanceWindowDays }
  | { status: "failed"; windowDays: PerformanceWindowDays };

export function isPerformanceWindow(value: number): value is PerformanceWindowDays {
  return (PERFORMANCE_WINDOWS as readonly number[]).includes(value);
}

export async function loadPerformanceWindow(
  userId: string,
  windowDays: PerformanceWindowDays,
  options: { timeoutMs?: number; compute?: typeof getPerformanceMetrics } = {},
): Promise<PerformanceWindowResult> {
  const compute = options.compute ?? getPerformanceMetrics;
  const timeoutMs = options.timeoutMs ?? PERFORMANCE_WINDOW_TIMEOUT_MS;
  let timer: ReturnType<typeof setTimeout> | null = null;
  try {
    const outcome = await Promise.race([
      compute(userId, windowDays).then((metrics) => ({ kind: "done" as const, metrics })),
      new Promise<{ kind: "timeout" }>((resolve) => {
        timer = setTimeout(() => resolve({ kind: "timeout" }), timeoutMs);
      }),
    ]);
    if (outcome.kind === "timeout") return { status: "timed_out", windowDays };
    return { status: "ready", windowDays, metrics: { ...outcome.metrics, windowStart: outcome.metrics.windowStart.toISOString() } };
  } catch {
    return { status: "failed", windowDays };
  } finally {
    if (timer) clearTimeout(timer);
  }
}
