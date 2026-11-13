/**
 * What a Live ops viewer may see, from their operations pack (pure; the
 * server reads the pack live with getOpsAccess on every request).
 *
 * Defaults pending owner confirmation (2026-11-14):
 * - Live ops, the position snapshot, the stream and the board: Dashboard pack
 *   at read (not System).
 * - Laundry drivers on the board and the map: Laundry pack at read.
 * - Pending continuation requests: Approvals pack at read.
 * - Actions on a job (pause clock, notify client): Jobs pack at manage — the
 *   action routes re-check through the office-send rules.
 * An administrator (levels null) sees everything.
 */
import type { OpsLevels } from "@/lib/rbac/ops-catalog";

export type LiveAccess = {
  live: boolean;
  drivers: boolean;
  continuations: boolean;
  jobActions: boolean;
};

const reads = (level: string | undefined) => level === "read" || level === "manage";

export function liveAccessFor(levels: OpsLevels | null): LiveAccess {
  if (!levels) return { live: true, drivers: true, continuations: true, jobActions: true };
  return {
    live: reads(levels.dashboard),
    drivers: reads(levels.laundry),
    continuations: reads(levels.approvals),
    jobActions: levels.jobs === "manage",
  };
}
