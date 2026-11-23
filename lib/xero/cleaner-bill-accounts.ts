/**
 * Which Xero account each line of a cleaner (payee) bill goes to (2026-11-23).
 *
 * Before: `pushCleanerBillToXero` sent every line with `line.accountCode ||
 * "400"`, and no caller ever set `accountCode`, so every cleaner bill landed on
 * account 400 whatever that account is in the organisation's chart. Now the
 * account is an explicit setting (Settings › Money › Xero, stored with the
 * other Xero codes in `phase3_integrations_v1`):
 *
 * - Cleaning work (required): job lines, extras, shopping time.
 * - QA inspections (optional): inspection lines and the inspector's travel.
 * - Reimbursements (optional): money the payee spent and gets back (shopping
 *   expenses; parking and receipt extras).
 *
 * The two optional accounts say on screen that, left empty, their lines use the
 * cleaning work account. With no cleaning work account the push is refused
 * before anything is sent ("choose the Xero account for cleaner invoices in
 * Settings"); no account is ever guessed. Plain module.
 */

export type CleanerBillAccountSettings = {
  cleanerBillAccountCode?: string | null;
  cleanerBillInspectionAccountCode?: string | null;
  cleanerBillReimbursementAccountCode?: string | null;
};

export type CleanerBillLineKind = "LABOUR" | "INSPECTION" | "REIMBURSEMENT";

/** What the stored snapshot line says about itself (lineData.lines[]). */
export type CleanerBillSnapshotLine = {
  kind?: unknown;
  category?: unknown;
  description?: unknown;
};

/** Xero account codes: letters, digits, dot, dash or underscore, at most 10. */
export const XERO_ACCOUNT_CODE_PATTERN = /^[A-Za-z0-9._-]{1,10}$/;

export const CLEANER_BILL_ACCOUNT_REFUSAL =
  "Choose the Xero account for cleaner invoices in Settings › Money › Xero before pushing. Nothing was sent to Xero.";

export function cleanXeroAccountCode(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export function isValidXeroAccountCode(value: string): boolean {
  return value === "" || XERO_ACCOUNT_CODE_PATTERN.test(value);
}

/**
 * The kind of one line. `category` is stamped at send time since 2026-11-23;
 * older snapshots carry `kind` (CLEANING / INSPECTION) and their shopping
 * reimbursement lines are recognised by the description the send route wrote.
 * Anything else is cleaning work.
 */
export function cleanerBillLineKind(line: CleanerBillSnapshotLine): CleanerBillLineKind {
  if (line.category === "REIMBURSEMENT") return "REIMBURSEMENT";
  if (line.category === "INSPECTION" || line.kind === "INSPECTION") return "INSPECTION";
  if (line.category === "LABOUR") return "LABOUR";
  if (typeof line.description === "string" && line.description.startsWith("Shopping reimbursement")) return "REIMBURSEMENT";
  return "LABOUR";
}

export type CleanerBillAccountPlan =
  | { ok: true; codes: string[]; labourCode: string; inspectionCode: string; reimbursementCode: string }
  | { ok: false; reason: string };

/** The account code for every line, in order, or the refusal when the cleaning work account is not set. */
export function planCleanerBillAccounts(lines: readonly CleanerBillSnapshotLine[], settings: CleanerBillAccountSettings): CleanerBillAccountPlan {
  const labourCode = cleanXeroAccountCode(settings.cleanerBillAccountCode);
  if (!labourCode || !XERO_ACCOUNT_CODE_PATTERN.test(labourCode)) return { ok: false, reason: CLEANER_BILL_ACCOUNT_REFUSAL };
  const inspection = cleanXeroAccountCode(settings.cleanerBillInspectionAccountCode);
  const reimbursement = cleanXeroAccountCode(settings.cleanerBillReimbursementAccountCode);
  const inspectionCode = inspection && XERO_ACCOUNT_CODE_PATTERN.test(inspection) ? inspection : labourCode;
  const reimbursementCode = reimbursement && XERO_ACCOUNT_CODE_PATTERN.test(reimbursement) ? reimbursement : labourCode;
  const codes = lines.map((line) => {
    const kind = cleanerBillLineKind(line);
    return kind === "INSPECTION" ? inspectionCode : kind === "REIMBURSEMENT" ? reimbursementCode : labourCode;
  });
  return { ok: true, codes, labourCode, inspectionCode, reimbursementCode };
}
