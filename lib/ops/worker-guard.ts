/**
 * The wrapper around every pg-boss handler in workers/boss.ts.
 *
 * - A throwing handler never crashes the worker and is never retried by
 *   pg-boss (returning normally completes the job): a scheduled job runs
 *   again on its next tick, so a send inside it is retried at most once per
 *   tick and only through its own idempotency (receipts, claimed flags).
 * - A hard timeout stops the worker waiting. The handler itself cannot be
 *   cancelled, so the next tick of the SAME job is skipped while the earlier
 *   run is still going: two copies of one sweep never send side by side.
 * - After FAILURE_ALERT_AFTER failures in a row administrators are told once
 *   (sending safeguards incident, inbox + one email); the incident closes
 *   when the job succeeds again.
 */
export const FAILURE_ALERT_AFTER = 3;

export type JobRunRecord = { name: string; ok: boolean; durationMs: number; error?: string; skipped?: boolean };

export type WorkerGuardDeps = {
  log: { warn: (data: object, message: string) => void; error: (data: object, message: string) => void };
  recordRun: (run: JobRunRecord) => void;
  recordFailure: (jobName: string, error: unknown) => void;
  raiseFailure: (jobName: string, failures: number, error: string) => Promise<unknown>;
  resolveFailure: (jobName: string) => Promise<unknown>;
};

export function createWorkerGuard(deps: WorkerGuardDeps) {
  const running = new Set<string>();
  const failures = new Map<string, number>();

  async function noteFailure(jobName: string, error: unknown) {
    const count = (failures.get(jobName) ?? 0) + 1;
    failures.set(jobName, count);
    if (count !== FAILURE_ALERT_AFTER) return;
    const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
    await deps.raiseFailure(jobName, count, message).catch((alertError: unknown) => deps.log.error({ err: alertError, jobName }, "[worker] failure alert could not be raised"));
  }

  async function noteSuccess(jobName: string) {
    const count = failures.get(jobName) ?? 0;
    failures.delete(jobName);
    if (count >= FAILURE_ALERT_AFTER) await deps.resolveFailure(jobName).catch(() => undefined);
  }

  function safeHandler<T>(jobName: string, handler: (job?: { data: T }) => Promise<unknown>, timeoutMs: number) {
    return async (job?: { data: T }) => {
      if (running.has(jobName)) {
        deps.log.warn({ jobName }, `[worker] ${jobName} skipped: the previous run is still going`);
        deps.recordRun({ name: jobName, ok: true, durationMs: 0, skipped: true });
        return;
      }
      running.add(jobName);
      const start = Date.now();
      const work = handler(job).finally(() => running.delete(jobName));
      // A late rejection after the timeout must not become an unhandled rejection.
      work.catch(() => undefined);
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([
          work,
          new Promise((_, reject) => {
            timer = setTimeout(() => reject(new Error(`Handler timeout after ${timeoutMs}ms`)), timeoutMs);
          }),
        ]);
        deps.recordRun({ name: jobName, ok: true, durationMs: Date.now() - start });
        await noteSuccess(jobName);
      } catch (error) {
        deps.log.error({ err: error, jobName }, `[worker] ${jobName} failed`);
        deps.recordFailure(jobName, error);
        deps.recordRun({ name: jobName, ok: false, durationMs: Date.now() - start, error: error instanceof Error ? error.message : String(error) });
        await noteFailure(jobName, error);
        // Swallow: returning normally tells pg-boss the job is done, so it is
        // never retried in a fast loop (and never sends twice on a retry).
      } finally {
        if (timer) clearTimeout(timer);
      }
    };
  }

  return { safeHandler, isRunning: (jobName: string) => running.has(jobName) };
}
