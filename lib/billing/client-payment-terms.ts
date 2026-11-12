/**
 * A client's own payment terms (Client.paymentTermsDays; null = organisation
 * default). Who may change them, the bounds and the audit row live here so the
 * route stays thin.
 *
 * Who: ADMIN always (independently of operations packs). An OPS_MANAGER only
 * with "manage" on the finance feature, the same right that lets them change
 * invoices: terms set the due date printed on the client's invoices.
 *
 * Changing terms never moves an issued invoice's due date: an invoice keeps
 * the terms snapshotted when it was first sent (invoice-terms.ts).
 */
import { z } from "zod";
import { db } from "@/lib/db";
import { getOpsAccess } from "@/lib/rbac/ops-access";
import { canUseOpsPath } from "@/lib/rbac/ops-catalog";
import { CLIENT_PAYMENT_TERMS_MAX_DAYS, CLIENT_PAYMENT_TERMS_MIN_DAYS } from "./invoice-due";
import { actionResult, type InvoiceActionResult } from "./invoice-action-result";

export const paymentTermsBodySchema = z.object({
  paymentTermsDays: z
    .number()
    .int("Payment terms are whole days.")
    .min(CLIENT_PAYMENT_TERMS_MIN_DAYS)
    .max(CLIENT_PAYMENT_TERMS_MAX_DAYS, `Payment terms can be at most ${CLIENT_PAYMENT_TERMS_MAX_DAYS} days.`)
    .nullable(),
});

type TermsActor = { id: string; role: string; heldRoles?: string[] };

/** True when this person may change a client's payment terms. */
export async function canEditClientPaymentTerms(actor: TermsActor): Promise<boolean> {
  const levels = await getOpsAccess(actor);
  if (!levels) return actor.role === "ADMIN";
  return canUseOpsPath(levels, "/api/admin/invoices/terms", "PATCH");
}

export async function updateClientPaymentTerms(input: {
  clientId: string;
  body: unknown;
  actor: TermsActor;
}): Promise<InvoiceActionResult> {
  if (!(await canEditClientPaymentTerms(input.actor))) {
    return actionResult({ error: "Only an administrator, or an operations manager who manages finance, can change payment terms." }, 403);
  }
  const parsed = paymentTermsBodySchema.safeParse(input.body);
  if (!parsed.success) {
    return actionResult({ error: parsed.error.issues[0]?.message ?? `Payment terms must be 0 to ${CLIENT_PAYMENT_TERMS_MAX_DAYS} days, or the default.` }, 400);
  }
  const next = parsed.data.paymentTermsDays;
  return db.$transaction(async (tx) => {
    const existing = await tx.client.findUnique({ where: { id: input.clientId }, select: { id: true, paymentTermsDays: true } });
    if (!existing) return actionResult({ error: "Client not found." }, 404);
    if (existing.paymentTermsDays === next) return actionResult({ ok: true, paymentTermsDays: next, unchanged: true });
    await tx.client.update({ where: { id: input.clientId }, data: { paymentTermsDays: next } });
    await tx.auditLog.create({
      data: {
        userId: input.actor.id,
        action: "CLIENT_PAYMENT_TERMS_UPDATED",
        entity: "Client",
        entityId: input.clientId,
        before: { paymentTermsDays: existing.paymentTermsDays },
        after: { paymentTermsDays: next, note: "Issued invoices keep the terms they were sent with." },
      },
    });
    return actionResult({ ok: true, paymentTermsDays: next });
  });
}
