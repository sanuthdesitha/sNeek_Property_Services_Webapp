// @vitest-environment node
/** Pure rules from the finance decisions step (2026-11-11). */
import { describe, expect, it } from "vitest";
import { invoicedThisMonthFrom, sentInMonthWhere } from "@/lib/billing/client-invoice-stats";
import { auditActorLabel, systemActorOf, SYSTEM_XERO_SYNC_ACTOR } from "@/lib/audit/system-actor";
import { xeroScopes, xeroSignInMessage, xeroSignInState } from "@/lib/xero/client";
import {
  DEFAULT_INSIGHTS_EMAIL_SETTINGS,
  insightsEmailDue,
  previousMonthKey,
  sanitizeInsightsEmailSettings,
} from "@/lib/insights/monthly-email-settings";
import { effectivePaymentTermsDays, invoiceDueDay } from "@/lib/billing/invoice-due";
import { planJobReset, DEFAULT_JOB_RESET_OPTIONS } from "@/lib/jobs/job-reset";
import { payRateUnknown } from "@/lib/insights/job-facts";
import { filterRows } from "@/lib/accounts/list/derive";
import { parseAccountFilters, type AccountRow } from "@/lib/accounts/list/types";
import { financeTabRedirect } from "@/lib/admin/finance-redirects";

describe("Invoiced this month", () => {
  it("is invoices first sent this month less credit notes sent this month, void excluded", () => {
    const start = new Date("2026-10-31T13:00:00Z");
    const next = new Date("2026-11-30T13:00:00Z");
    expect(sentInMonthWhere("INVOICE", start, next)).toEqual({ kind: "INVOICE", status: { not: "VOID" }, sentAt: { gte: start, lt: next } });
    expect(invoicedThisMonthFrom({ invoices: { count: 3, sum: 1100 }, creditNotes: { count: 1, sum: -110 }, monthStart: "2026-11-01" }))
      .toEqual({ total: 990, invoiceCount: 3, invoiceTotal: 1100, creditNoteCount: 1, creditTotal: 110, monthStart: "2026-11-01" });
    // Nothing sent is a true zero, not missing data.
    expect(invoicedThisMonthFrom({ invoices: { count: 0, sum: null }, creditNotes: { count: 0, sum: null }, monthStart: "2026-11-01" }).total).toBe(0);
  });
});

describe("payment terms and due dates", () => {
  it("an issued invoice keeps its snapshot; a draft follows the client, then the default", () => {
    expect(effectivePaymentTermsDays({ invoiceTermsDays: 14, clientTermsDays: 30, organisationDefaultDays: 7 })).toBe(14);
    expect(effectivePaymentTermsDays({ invoiceTermsDays: null, clientTermsDays: 30, organisationDefaultDays: 7 })).toBe(30);
    expect(effectivePaymentTermsDays({ invoiceTermsDays: null, clientTermsDays: null, organisationDefaultDays: 7 })).toBe(7);
    expect(effectivePaymentTermsDays({ clientTermsDays: 0, organisationDefaultDays: 14 })).toBe(0);
    // Same created date, the snapshot decides the printed day.
    const created = new Date("2026-10-16T00:00:00Z");
    expect(invoiceDueDay(created, effectivePaymentTermsDays({ invoiceTermsDays: 14, clientTermsDays: 45, organisationDefaultDays: 14 }), "Australia/Sydney")).toBe("2026-10-30");
  });
});

describe("system actor for scheduled Xero checks", () => {
  it("labels marked rows (and legacy scheduled rows) as the system, never the administrator", () => {
    const admin = { name: "Earliest Admin", email: "a@x" };
    expect(auditActorLabel({ systemActor: SYSTEM_XERO_SYNC_ACTOR }, admin)).toBe("System: Xero sync (scheduled)");
    expect(auditActorLabel({ trigger: "scheduled", source: "XERO" }, admin)).toBe("System: Xero sync (scheduled)");
    expect(auditActorLabel({ trigger: "manual", source: "XERO" }, admin)).toBe("Earliest Admin");
    expect(systemActorOf(null)).toBeNull();
  });
});

describe("Xero stays signed in", () => {
  it("requests offline_access unless explicitly switched off", () => {
    expect(xeroScopes({}).split(" ")).toContain("offline_access");
    expect(xeroScopes({ XERO_REQUEST_OFFLINE_ACCESS: "false" })).toBe("accounting.contacts accounting.invoices");
  });
  it("states a connection with no refresh token, and a lapsed one, plainly", () => {
    const now = new Date("2026-11-12T00:00:00Z");
    const later = new Date("2026-11-12T00:20:00Z");
    const earlier = new Date("2026-11-11T23:00:00Z");
    expect(xeroSignInState({ refreshToken: "", expiresAt: later, lastSyncError: null }, now)).toBe("no-refresh-token");
    expect(xeroSignInState({ refreshToken: "", expiresAt: earlier, lastSyncError: null }, now)).toBe("lapsed");
    expect(xeroSignInState({ refreshToken: "r", expiresAt: earlier, lastSyncError: null }, now)).toBe("ok");
    expect(xeroSignInState({ refreshToken: "r", expiresAt: earlier, lastSyncError: "SIGN_IN_LAPSED: refresh refused (400)" }, now)).toBe("lapsed");
    expect(xeroSignInMessage("lapsed")).toBe("Xero sign-in lapsed — reconnect");
    expect(xeroSignInMessage("no-refresh-token")).toBe("Reconnect Xero once to keep it signed in");
    expect(xeroSignInMessage("ok")).toBeNull();
  });
});

describe("monthly Insights email settings", () => {
  it("is off by default and a bad stored value never turns it on", () => {
    expect(sanitizeInsightsEmailSettings(undefined)).toEqual(DEFAULT_INSIGHTS_EMAIL_SETTINGS);
    expect(sanitizeInsightsEmailSettings({ enabled: "yes", recipientIds: ["ok-1", "bad id!", 3], dayOfMonth: 31, hour: 25, sections: ["money", "nope"] }))
      .toEqual({ enabled: false, recipientIds: ["ok-1"], dayOfMonth: 1, hour: 8, sections: ["money"] });
  });
  it("is due for the previous month once the configured day and hour (organisation timezone) is reached", () => {
    const settings = { ...DEFAULT_INSIGHTS_EMAIL_SETTINGS, enabled: true, recipientIds: ["a"], dayOfMonth: 2, hour: 9 };
    // 2 Nov 08:30 Sydney (AEDT) = 1 Nov 21:30 UTC: not yet.
    expect(insightsEmailDue(settings, new Date("2026-11-01T21:30:00Z"), "Australia/Sydney").due).toBe(false);
    expect(insightsEmailDue(settings, new Date("2026-11-01T22:05:00Z"), "Australia/Sydney")).toEqual({ due: true, reportMonth: "2026-10" });
    expect(insightsEmailDue({ ...settings, enabled: false }, new Date("2026-11-20T00:00:00Z"), "Australia/Sydney").due).toBe(false);
    expect(insightsEmailDue({ ...settings, recipientIds: [] }, new Date("2026-11-20T00:00:00Z"), "Australia/Sydney").due).toBe(false);
    expect(previousMonthKey("2027-01")).toBe("2026-12");
  });
});

describe("job reset lock follows the financial-record rule", () => {
  it("a line on a non-void invoice locks evidence; a voided one (not counted) does not", () => {
    const base = { status: "COMPLETED", timeLogCount: 2, assigneeCount: 1 };
    const options = { ...DEFAULT_JOB_RESET_OPTIONS, clearTimeLogs: true };
    expect(planJobReset(options, { ...base, invoicedLineCount: 1 }).allowed).toBe(false);
    expect(planJobReset(options, { ...base, invoicedLineCount: 0 }).allowed).toBe(true);
  });
});

describe("Finance overview: no silent default pay rate", () => {
  it("a clean with any payee missing a rate is not costed (same test as Insights)", () => {
    expect(payRateUnknown([{ rateMissing: false }, { rateMissing: true }])).toBe(true);
    expect(payRateUnknown([{ rateMissing: false }])).toBe(false);
  });
  it("the Accounts list can show cleaners with no pay rate", () => {
    const filters = parseAccountFilters(new URLSearchParams("tab=cleaners&rate=none"));
    expect(filters.noRate).toBe(true);
    const row = (id: string, rate: number | null) => ({ id, name: id, email: `${id}@x`, phone: null, role: "CLEANER", extraRoles: [], status: "ACTIVE", inviteAgeDays: null, emailVerified: true, twoFactorEnabled: false, clientName: null, rate, documents: { kind: "OK", label: "" }, lastSeenAt: null, attention: [] }) as unknown as AccountRow;
    expect(filterRows([row("a", null), row("b", 32)], filters).map((r) => r.id)).toEqual(["a"]);
  });
});

describe("classic finance screens", () => {
  it("send classic invoice management to Invoices and pay, keeping other params", () => {
    expect(financeTabRedirect("invoices", { tab: "invoices", status: "SENT" })).toBe("/v2/admin/finance?tab=invoices&status=SENT");
    expect(financeTabRedirect("cleaner-invoices", { status: "SUBMITTED" })).toBe("/v2/admin/finance?tab=cleaner-invoices&status=SUBMITTED");
  });
});
