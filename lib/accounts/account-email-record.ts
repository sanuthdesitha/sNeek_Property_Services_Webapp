import "server-only";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { sendEmailDetailed } from "@/lib/notifications/email";
import type { AccountEmailState, AccountEmailType } from "./account-email-rules";

/**
 * Sends one account email through the existing mail path and records it for
 * the person's Accounts › Account emails history (audit ACCOUNT_EMAIL_SENT),
 * with who sent it (null actor = the person asked themselves) and the
 * provider's real answer. Accepted is never shown as delivered.
 */
export const ACCOUNT_EMAIL_AUDIT_ACTION = "ACCOUNT_EMAIL_SENT";

export type AccountEmailOrigin = "PERSON_PANEL" | "BULK" | "SELF_SERVICE";

type ProviderAnswer = { ok: boolean; error?: string; skipped?: boolean; acceptance?: "ACCEPTED" | "NOT_ACCEPTED" | "UNKNOWN" | null; externalId?: string | null };

export function accountEmailState(answer: ProviderAnswer): AccountEmailState {
  if (answer.ok) return "ACCEPTED";
  if (answer.skipped || /not configured/i.test(answer.error ?? "")) return "SKIPPED";
  if (answer.acceptance === "UNKNOWN") return "UNKNOWN";
  return "NOT_ACCEPTED";
}

type RecordInput = {
  targetUserId: string;
  actorId: string | null;
  actorRole: "ADMIN" | "OPS_MANAGER" | null;
  type: AccountEmailType;
  origin: AccountEmailOrigin;
  /** The address it was sent to (the person's account address at the time). */
  to: string;
  /** Either an email to send now, or the answer of a helper that already sent it. */
  send?: Parameters<typeof sendEmailDetailed>[0];
  answer?: ProviderAnswer;
};

export async function recordAccountEmail(input: RecordInput): Promise<{ state: AccountEmailState; error: string | null }> {
  const answer: ProviderAnswer = input.send ? await sendEmailDetailed(input.send) : input.answer ?? { ok: false, acceptance: "UNKNOWN", error: "No provider answer." };
  const state = accountEmailState(answer);
  await db.auditLog.create({
    data: {
      userId: input.actorId ?? input.targetUserId,
      action: ACCOUNT_EMAIL_AUDIT_ACTION,
      entity: "User",
      entityId: input.targetUserId,
      after: {
        type: input.type,
        origin: input.origin,
        to: input.to,
        state,
        error: answer.ok ? null : answer.error ?? null,
        externalId: answer.externalId ?? null,
        actorRole: input.actorRole,
        sentBy: input.actorId ? "OFFICE" : "SELF",
        deliveryConfirmed: false,
      } satisfies Record<string, unknown> as Prisma.InputJsonValue,
    },
  });
  return { state, error: answer.ok ? null : answer.error ?? null };
}
