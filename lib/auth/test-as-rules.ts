/**
 * What each "Test as" mode can and cannot do (board "Test as", 2026-11),
 * written from the places the server enforces it. The Test as page renders
 * its table from this list; `tests/lib/test-as-rules.test.ts` reads every
 * enforcement file named here and scans `app/api` for routes that check
 * `session.impersonation` or the actual-actor rule, so a new refusal cannot
 * ship without a row and a row cannot outlive its enforcement point.
 *
 * Plain data (no "use client", no server imports). It DESCRIBES the rules;
 * it decides nothing. Changing a word here changes no behaviour.
 */

export type TestAsAnswerKind = "yes" | "real" | "refused" | "not_recorded" | "no";

export type TestAsAnswer = { kind: TestAsAnswerKind; words: string };

/** A file and a piece of code that must appear in it, proving the rule is enforced there. */
export type TestAsEnforcementPoint = { file: string; contains: string };

export type TestAsRule = {
  key: "see" | "change" | "location" | "pin" | "devices" | "decisions" | "office" | "nested";
  label: string;
  viewOnly: TestAsAnswer;
  full: TestAsAnswer;
  /** How it is enforced, in one line (shown to nobody; for reviewers and the test). */
  how: string;
  enforcement: readonly TestAsEnforcementPoint[];
  /**
   * Routes under these folders that refuse while testing belong to this row
   * without being named one by one (office routes are reachable only while
   * testing an operations manager).
   */
  enforcementFolders?: readonly string[];
};

const YES: TestAsAnswer = { kind: "yes", words: "Yes" };
const REFUSED: TestAsAnswer = { kind: "refused", words: "Refused" };
const NO: TestAsAnswer = { kind: "no", words: "No" };

const route = (path: string, contains = "session.impersonation"): TestAsEnforcementPoint => ({ file: `app/api/${path}/route.ts`, contains });

export const TEST_AS_RULES: readonly TestAsRule[] = [
  {
    key: "see",
    label: "See their pages and data",
    viewOnly: YES,
    full: YES,
    how: "requireSession() and validate-session swap the identity for the person being tested as, with only their roles.",
    enforcement: [
      { file: "lib/auth/session.ts", contains: "heldRoles: [impersonation.target.role]" },
      { file: "app/api/auth/validate-session/route.ts", contains: "heldRoles: [impersonation.target.role]" },
    ],
  },
  {
    key: "change",
    label: "Change anything (save, submit, send)",
    viewOnly: REFUSED,
    full: { kind: "real", words: "Yes, real, in their name" },
    how: "Middleware refuses every unsafe method while a view-only ticket is present (IMPERSONATION_READ_ONLY); a few routes repeat it.",
    enforcement: [
      { file: "middleware.ts", contains: "IMPERSONATION_READ_ONLY" },
      // The choke point must see the real method (edge runtime, 2026-11-17).
      { file: "middleware.ts", contains: "new NextRequest(original, { headers, method: original.method })" },
      { file: "lib/auth/impersonation.ts", contains: "export function isReadOnlySafeMethod" },
      route("me/jobs-views", "IMPERSONATION_READ_ONLY"),
      route("cleaner/inventory/held-stock", 'session.impersonation?.mode === "READ_ONLY"'),
      route("cleaner/inventory/held-stock/[id]/deliver", 'session.impersonation?.mode === "READ_ONLY"'),
      route("cleaner/inventory/held-stock/batch", 'session.impersonation?.mode === "READ_ONLY"'),
    ],
  },
  {
    key: "location",
    label: "Location and GPS check-in",
    viewOnly: REFUSED,
    full: { kind: "not_recorded", words: "Not recorded" },
    how: "Location routes skip recording (or refuse) while testing: the administrator's position is never the person's.",
    enforcement: [
      route("cleaner/jobs/[id]/gps-checkin"),
      route("cleaner/jobs/[id]/gps-checkout"),
      route("cleaner/jobs/[id]/location-ping"),
      route("cleaner/jobs/[id]/start"),
      route("cleaner/jobs/[id]/stop"),
      route("cleaner/jobs/[id]/start-driving"),
      route("cleaner/location/ping"),
      route("cleaner/location/active-job"),
      route("laundry/location/ping"),
      route("laundry/location/active-route"),
      route("laundry/route"),
      route("me/location-notice"),
    ],
  },
  {
    key: "pin",
    label: "Anything asking for a PIN (void, delete, reset, rules)",
    viewOnly: REFUSED,
    full: { kind: "refused", words: "Refused: it needs your own PIN" },
    how: "The actual-actor rule: a PIN is checked only for the signed-in person acting as themselves (ACTUAL_ACTOR_REQUIRED).",
    enforcement: [
      { file: "lib/security/actual-actor.ts", contains: "ACTUAL_ACTOR_REQUIRED" },
      { file: "lib/security/admin-verification.ts", contains: "ACTUAL_ACTOR_REQUIRED" },
      { file: "lib/security/route-verification.ts", contains: "ACTUAL_ACTOR_REQUIRED" },
      { file: "lib/security/pin-rules.ts", contains: "ACTUAL_ACTOR_REQUIRED" },
      { file: "lib/scheduling-rules/http.ts", contains: "ACTUAL_ACTOR_REQUIRED" },
      { file: "lib/billing/client-invoice-patch-rules.ts", contains: "ACTUAL_ACTOR_REQUIRED" },
      route("admin/security/verify", "ACTUAL_ACTOR_REQUIRED"),
      route("admin/test-as/unlock", "ACTUAL_ACTOR_REQUIRED"),
      route("admin/ai/credentials", "ACTUAL_ACTOR_REQUIRED"),
      route("admin/invoices/[id]/reconcile"),
    ],
  },
  {
    key: "devices",
    label: "Their signed-in devices, sign-in security, notification and sending choices",
    viewOnly: REFUSED,
    full: REFUSED,
    how: "Self-service routes refuse while testing: these belong to the person, never to someone viewing as them.",
    enforcement: [
      route("push/subscribe"),
      route("push/unsubscribe"),
      route("me/notification-preferences"),
      route("me/notification-switches"),
      route("me/client-notification-preferences"),
      route("notifications/preferences"),
      route("me/send-transports"),
      route("me/sessions"),
      route("me/password"),
      route("me/admin-pin", "ACTUAL_ACTOR_REQUIRED"),
      route("me/tours"),
      route("me/tours/preference"),
      route("auth/2fa/settings"),
      route("auth/2fa/backup-codes"),
      route("auth/webauthn/credentials/[id]"),
      route("auth/webauthn/register/options"),
      route("auth/webauthn/register/verify"),
      route("notifications/log"),
      route("notifications/inbox-state"),
      route("client/marketing-consent"),
    ],
  },
  {
    key: "decisions",
    label: "Raise QA issues, reset someone's PIN, answer the office, re-confirm a changed job briefing, ask the office about a property that looks unused or about photos that cannot be taken",
    viewOnly: REFUSED,
    full: REFUSED,
    how: "These are the reviewer's or partner's own acts; the routes refuse while testing.",
    enforcement: [
      route("admin/quality/issues"),
      route("admin/quality/issues/case-options"),
      route("admin/quality/bonus-proposals"),
      route("admin/users/[id]/reset-pin"),
      route("qa/jobs/[id]/photo-review"),
      route("qa/visit-order"),
      route("laundry/office-requests/[requestId]/reply"),
      route("laundry/quantity-exceptions"),
      // A cleaner's confirmation that they read a changed briefing is evidence
      // of their own reading; an administrator testing as them cannot give it.
      route("cleaner/jobs/[id]/briefing-ack"),
      // "Looks unused — ask the office" is the cleaner's own report from the property.
      route("cleaner/jobs/[id]/unused-check"),
      // "Camera not working — ask the office" is the cleaner's own statement about their phone.
      route("cleaner/jobs/[id]/evidence-override"),
    ],
  },
  {
    key: "office",
    label: "Office sends, switches and settings (testing an operations manager)",
    viewOnly: REFUSED,
    full: REFUSED,
    how: "Office routes that message people, change switches or record approvals refuse while testing.",
    enforcement: [
      { file: "app/api/admin/notifications/actions/handler.ts", contains: "session.impersonation" },
      route("admin/notifications/catalog"),
      route("admin/notifications/catalog/test"),
    ],
    enforcementFolders: ["app/api/admin/"],
  },
  {
    key: "nested",
    label: "Test as someone else from inside",
    viewOnly: NO,
    full: NO,
    how: "While testing, validate-session reports the person's roles and no administrator capabilities, so the Test as page is not reachable.",
    enforcement: [
      { file: "app/api/auth/validate-session/route.ts", contains: "opsGrants: []" },
      { file: "lib/rbac/ops-catalog.ts", contains: '"access.test_as"' },
    ],
  },
];

/**
 * Routes that read the testing state only to record who really acted, or to
 * leave out a saved preference, without refusing anything. Listed so the
 * scan in the test knows them.
 */
export const TEST_AS_ATTRIBUTION_ONLY: readonly string[] = [
  "app/api/cleaner/jobs/[id]/evidence/route.ts",
  "app/api/notifications/stream/route.ts",
  "app/api/admin/jobs/[id]/evidence-review/route.ts",
  "app/api/admin/jobs/[id]/route.ts",
  "app/api/admin/jobs/[id]/office-message/route.ts",
  "app/api/admin/jobs/[id]/qa-reset/route.ts",
  "app/api/admin/jobs/[id]/assign/route.ts",
  "app/api/admin/jobs/[id]/reset/route.ts",
  "app/api/admin/cases/[id]/invoice-charge/route.ts",
  "app/api/admin/invoices/[id]/route.ts",
  "app/api/admin/invoices/[id]/credit-note/route.ts",
  "app/api/admin/agent-requests/route.ts",
  "app/api/admin/payroll/runs/[id]/route.ts",
  "app/api/admin/qa/assignments/reorder/route.ts",
  "app/api/admin/approvals/history/[id]/route.ts",
  "app/api/admin/inventory/shopping-runs/[id]/route.ts",
  "app/api/admin/workforce/document-reminder/route.ts",
  "app/api/admin/workforce/document-request/route.ts",
  "app/api/admin/va-teams/[id]/members/[userId]/route.ts",
  "app/api/admin/cleaners/addresses/update-request/route.ts",
  "app/api/admin/pay-adjustments/[id]/route.ts",
  "app/api/admin/ops-permissions/route.ts",
];

/** The roles that can be tested as, with their portal (administrators never). */
export const TESTABLE_PORTALS = [
  { role: "CLEANER", label: "Cleaners", singular: "cleaner", portal: "/v2/cleaner" },
  { role: "CLIENT", label: "Clients", singular: "client", portal: "/v2/client" },
  { role: "QA_INSPECTOR", label: "QA inspectors", singular: "QA inspector", portal: "/v2/qa" },
  { role: "LAUNDRY", label: "Laundry", singular: "laundry partner", portal: "/v2/laundry" },
  { role: "MAINTENANCE", label: "Maintenance", singular: "maintenance worker", portal: "/v2/maintenance" },
  { role: "OPS_MANAGER", label: "Ops managers", singular: "operations manager", portal: "/v2/admin" },
] as const;

export type TestableRole = (typeof TESTABLE_PORTALS)[number]["role"];

/** The portals listed in full; the rest fold into one "more" row until opened (board). */
export const TEST_AS_PRIMARY_ROLES: readonly TestableRole[] = ["CLEANER", "CLIENT", "QA_INSPECTOR"];

/** People shown per open group before "N more … Show". */
export const TEST_AS_GROUP_PREVIEW = 2;

export function testAsModeWords(mode: "READ_ONLY" | "FULL"): { short: string; long: string } {
  return mode === "READ_ONLY"
    ? { short: "View only", long: "View only · changes are blocked" }
    : { short: "Full, real", long: "Full access · changes are real" };
}

export function testableRoleLabel(role: string): string {
  return TESTABLE_PORTALS.find((entry) => entry.role === role)?.singular ?? role.replace(/_/g, " ").toLowerCase();
}
