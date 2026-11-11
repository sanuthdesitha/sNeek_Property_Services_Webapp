/**
 * Accounts bulk actions. Each selected person is run through the SAME
 * single-account service the per-person controls use, with its own guards,
 * and gets their own outcome; one refusal never stops the others.
 *
 *   resend-invite → lib/accounts/resend-invite   (ADMIN, OPS_MANAGER)
 *   disable       → lib/accounts/account-status  (ADMIN; not yourself, not the last active admin)
 *   change-rate   → lib/accounts/pay-rate        (ADMIN; same bounds and audit)
 *
 * "Message" is not offered: there is no staff messaging path that takes a
 * list of accounts through the notification intent pipeline.
 */
import { AccountGuardError, setAccountActive } from "./account-status";
import { PayRateError, updateHourlyRate } from "./pay-rate";
import { resendInvite } from "./resend-invite";
import type { AccountBulkRequest, AccountBulkResponse, AccountBulkResult } from "./bulk-types";

export * from "./bulk-types";

async function runOne(actorId: string, request: AccountBulkRequest, id: string): Promise<AccountBulkResult> {
  try {
    if (request.action === "resend-invite") {
      const result = await resendInvite(id);
      return result.ok ? { id, outcome: "done", message: "Invite sent." } : { id, outcome: "refused", message: result.error };
    }
    if (request.action === "disable") {
      const result = await setAccountActive(actorId, id, false);
      return result.changed ? { id, outcome: "done", message: "Disabled." } : { id, outcome: "unchanged", message: "Already disabled." };
    }
    const result = await updateHourlyRate(actorId, id, request.hourlyRate as number);
    return result.changed
      ? { id, outcome: "done", message: `Rate changed from ${result.before === null ? "not set" : `$${result.before.toFixed(2)}`} to $${result.after.toFixed(2)}.` }
      : { id, outcome: "unchanged", message: "Already at that rate." };
  } catch (error) {
    if (error instanceof AccountGuardError || error instanceof PayRateError) return { id, outcome: "refused", message: error.message };
    return { id, outcome: "refused", message: "Could not be changed. Try this person on their own." };
  }
}

/** Sequential, so the admin-set lock and rate audit rows apply one at a time. */
export async function runAccountBulk(actorId: string, request: AccountBulkRequest): Promise<AccountBulkResponse> {
  const ids = Array.from(new Set(request.ids));
  const results: AccountBulkResult[] = [];
  for (const id of ids) results.push(await runOne(actorId, request, id));
  return { action: request.action, results };
}
