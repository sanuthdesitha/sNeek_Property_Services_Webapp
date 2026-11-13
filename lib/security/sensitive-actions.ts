export const SENSITIVE_ACTIONS = {
  "jobs.delete": "Delete jobs",
  "jobs.reset": "Reset jobs and remove work records",
  "properties.archive": "Archive properties",
  "clients.delete": "Delete clients",
  "cases.delete": "Delete cases",
  "forms.delete": "Delete form templates",
  "laundry.delete": "Delete or override completed laundry",
  "invoices.correct": "Reconcile Xero invoice corrections",
  // Owner decision 2026-11-13.
  "invoices.void_credit": "Void invoices and raise or void credit notes",
  // Owner decision 2026-11-14: the scheduling rules are locked; unlocking,
  // publishing, restoring and importing need the person's own PIN.
  "scheduling.rules_edit": "Change, restore or import the scheduling rules",
  // Owner request 2026-11-14 (defaults pending owner confirmation): voiding a
  // laundry run and undoing a void are administrator actions with the
  // person's own PIN.
  "laundry.void": "Void laundry runs and undo voids",
} as const;
export type SensitiveAction = keyof typeof SENSITIVE_ACTIONS;
export type SensitiveGrants = Partial<Record<SensitiveAction, boolean>>;
