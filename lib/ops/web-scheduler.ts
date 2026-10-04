/**
 * Compatibility shim for old callers. Rendering a page must never run domain
 * mutations, send messages or act as a scheduler. All automation now belongs to
 * workers/boss.ts; a running dedicated worker is a deployment prerequisite.
 * Environment flags cannot re-enable request-driven scheduling.
 */
export function kickWebScheduledOps(): void {
  // Intentionally inert, including when a worker is unavailable.
}
