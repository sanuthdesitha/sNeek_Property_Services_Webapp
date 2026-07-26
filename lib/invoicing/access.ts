import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { getAppSettings } from "@/lib/settings";
import { isCleanerModuleEnabled } from "@/lib/portal-access";
import { INVOICE_PAYEE_ROLES } from "@/lib/profile/completeness";

/**
 * Access gate shared by every /api/cleaner/invoice/* endpoint.
 *
 * The invoice rail is no longer cleaner-only: QA inspectors are paid for
 * inspections on the SAME rail (lib/cleaner/invoice.ts already produces a
 * correct inspections-only invoice), so they self-invoice too. Widening the
 * role gate is safe ONLY because every one of those endpoints derives the payee
 * from `session.user.id` and never from a caller-supplied id — a payee can
 * therefore only ever read or send their own invoice.
 *
 * The cleaner portal's "invoices" visibility toggle stays scoped to CLEANERs:
 * it is an admin switch for the cleaner portal, and flipping it must not
 * silently cut off an inspector's ability to get paid.
 */
export async function requireInvoicePayeeSession() {
  const session = await requireRole(INVOICE_PAYEE_ROLES);
  if (session.user.role === Role.CLEANER) {
    const settings = await getAppSettings();
    if (!isCleanerModuleEnabled(settings, "invoices")) {
      throw new Error("INVOICES_DISABLED");
    }
  }
  return session;
}

/** Maps the thrown auth/gate errors to an HTTP status. */
export function invoiceErrorStatus(message: string | undefined): number {
  if (message === "UNAUTHORIZED") return 401;
  if (message === "FORBIDDEN" || message === "INVOICES_DISABLED") return 403;
  return 400;
}

export function invoiceErrorMessage(message: string | undefined): string {
  return message === "INVOICES_DISABLED"
    ? "Invoices are disabled for cleaners."
    : message ?? "Something went wrong.";
}

/** Filename stem for the generated PDF — reads correctly for either payee. */
export function invoiceFileStem(role: Role | string | null | undefined): string {
  return role === Role.QA_INSPECTOR ? "qa-inspector-invoice" : "cleaner-invoice";
}

/**
 * Both payee kinds share ONE admin-editable email template ("cleanerInvoice"),
 * because they share one rail — forking the template would let the two drift.
 * For an inspector the rendered copy would otherwise call their invoice a
 * "Cleaner Invoice", which is wrong on an invoice containing no cleans at all,
 * so relabel it. If the admin has rewritten the copy such that the phrase isn't
 * there, fall back to appending a marker rather than silently mislabelling.
 */
export function adaptInvoiceEmailForPayee(
  role: Role | string | null | undefined,
  email: { subject: string; html: string }
): { subject: string; html: string } {
  if (role !== Role.QA_INSPECTOR) return email;
  // Swap only the "cleaner" word, keeping the template's own casing of
  // "Invoice"/"invoice" so an admin's subject line still reads naturally.
  const relabel = (text: string) =>
    text.replace(/cleaner(\s+)(invoice)/gi, (_m, gap: string, word: string) => `QA inspector${gap}${word}`);
  const subject = relabel(email.subject);
  return {
    subject: subject === email.subject ? `${email.subject} (QA inspections)` : subject,
    html: relabel(email.html),
  };
}
