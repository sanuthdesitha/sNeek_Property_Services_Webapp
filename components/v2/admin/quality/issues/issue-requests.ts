/**
 * Calls to the EXISTING QA issue action endpoint, PATCH /api/admin/qa/issues/[id].
 * Every Quality hub action (detail dialog, expanded cleaner row) goes through
 * here, so the rules stay the endpoint's: rectify with minutes/photos,
 * propose a deduction (a PENDING pay adjustment awaiting approval), escalate,
 * and confirm or reject a suspected false confirmation.
 */
export type IssueActionBody =
  | { action: "rectify"; status: string; minutes?: number; beforeKeys?: string[]; afterKeys?: string[] }
  | { action: "proposeDeduction"; amount: number; note: string }
  | { action: "escalate"; reason: string }
  | { action: "falseConfirmation"; decision: "CONFIRMED" | "REJECTED" };

export type IssueActionResult = { ok: true } | { ok: false; error: string };

export async function patchIssue(issueId: string, body: IssueActionBody): Promise<IssueActionResult> {
  try {
    const response = await fetch(`/api/admin/qa/issues/${encodeURIComponent(issueId)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const json: unknown = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = (json as { error?: unknown }).error;
      return { ok: false, error: typeof error === "string" && error ? error : "The action failed." };
    }
    return { ok: true };
  } catch (cause) {
    return { ok: false, error: cause instanceof Error && cause.message ? cause.message : "The action failed." };
  }
}
