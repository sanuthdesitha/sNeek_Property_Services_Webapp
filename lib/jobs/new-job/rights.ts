/**
 * What the signed-in person may do on the New job page (plain module).
 * Rights depend on the role, the operations-manager packs and a read-only
 * "test as" session; never on the device. A phone and a desktop get the
 * same answer (owner default, pending confirmation: ops managers have the
 * same rights on a phone as on desktop). The routes re-check every write.
 */
import { opsLevelAllows, type OpsLevels } from "@/lib/rbac/ops-catalog";

export type NewJobRights = {
  /** Create jobs (POST /api/admin/jobs, assign). Jobs "manage". */
  canCreate: boolean;
  /** Save repeating rules (recurring-jobs routes belong to Calendar). */
  canRepeat: boolean;
  /** Why creating is not allowed, for the screen. */
  reason: string | null;
};

/** `levels` is null for administrators (they are not subject to packs). */
export function newJobRights(levels: OpsLevels | null, readOnlyImpersonation: boolean): NewJobRights {
  if (readOnlyImpersonation) {
    return { canCreate: false, canRepeat: false, reason: "You are testing as someone else in read-only mode, so nothing can be created." };
  }
  const canCreate = levels === null || opsLevelAllows(levels.jobs, "POST");
  const canRepeat = levels === null || opsLevelAllows(levels.calendar, "POST");
  return { canCreate, canRepeat, reason: canCreate ? null : "Your access to Jobs is view only, so you can look but not create." };
}
