/**
 * Which Quality hub tools an administrator or operations manager can actually
 * use, decided from the same pack rules the API middleware applies
 * (`canUseOpsPath`). Nothing here grants access: it only hides tools whose
 * endpoints would refuse the viewer, so a tab is never blank or half-working.
 *
 * `levels` is null for an ADMIN (full rights independent of packs).
 */
import { canUseOpsPath, type OpsLevels } from "@/lib/rbac/ops-catalog";

/** The endpoints the embedded coaching workspace calls. */
export const COACHING_RECORDS_API = "/api/admin/accountability/coaching";
export const COACHING_CLEANERS_API = "/api/admin/users?role=CLEANER";
export const COACHING_FULL_PAGE = "/v2/admin/workforce/coaching";
/** The endpoint the "Review bonus" dialog calls (one id stands for all). */
export const BONUS_DECISION_API = "/api/admin/pay-adjustments/bonus";
/** Who may create a pay adjustment today (the payroll pack's create route). */
export const PAY_ADJUSTMENT_CREATE_API = "/api/admin/pay-adjustments";
/** The manual "Propose bonus" route (quality pack, plus the payroll rule above). */
export const BONUS_PROPOSAL_API = "/api/admin/quality/bonus-proposals";

export type QualityHubAccess = {
  coaching: { visible: boolean; canManage: boolean; fullPageLink: boolean };
  canDecideBonus: boolean;
  /** "Propose bonus": exactly who may create a pay adjustment, and act in Quality. */
  canProposeBonus: boolean;
};

export function qualityHubAccess(levels: OpsLevels | null, canManageQuality: boolean): QualityHubAccess {
  const allows = (path: string, method = "GET") => levels === null || canUseOpsPath(levels, path, method);
  const visible = allows(COACHING_RECORDS_API) && allows(COACHING_CLEANERS_API);
  return {
    coaching: {
      visible,
      canManage: visible && allows(COACHING_RECORDS_API, "POST") && allows(`${COACHING_RECORDS_API}/record`, "PATCH"),
      fullPageLink: visible && allows(COACHING_FULL_PAGE),
    },
    canDecideBonus: canManageQuality && allows(BONUS_DECISION_API, "PATCH"),
    canProposeBonus: canManageQuality && allows(PAY_ADJUSTMENT_CREATE_API, "POST") && allows(BONUS_PROPOSAL_API, "POST"),
  };
}
