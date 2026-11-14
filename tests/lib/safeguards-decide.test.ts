// @vitest-environment node
/**
 * Sending safeguards, pure rules: the decision order, caps, duplicates,
 * same-subject window, pauses, emergency stop (security still goes), quiet
 * hours (held / dropped / urgent exempt), disabled accounts, the alert limit,
 * the limit bounds and how a send is classified.
 */
import { describe, expect, it } from "vitest";
import { decideOutbound, isInQuietHours, type GuardFacts } from "@/lib/notifications/safeguards/decide";
import { DEFAULT_SAFEGUARD_LIMITS, limitsOutOfBounds, normalizeSafeguardLimits, notSentText } from "@/lib/notifications/safeguards/config";
import { deriveTypeKey, isPausableTypeKey, messageClassFor, quietPolicyFor } from "@/lib/notifications/safeguards/classify";

const limits = DEFAULT_SAFEGUARD_LIMITS;

function facts(patch: Partial<GuardFacts> = {}): GuardFacts {
  return {
    transport: "EMAIL", messageClass: "NORMAL", quietPolicy: "HOLD", recipientInactive: false, recipientIsStaff: true,
    emergencyStop: false, pause: null, duplicateRecently: false, sameSubjectRecently: false, sentLastHour: 0, sentLastDay: 0,
    alertEmailsLastHour: 0, inQuietHours: false, releasedFromHold: false, holdable: true, ...patch,
  };
}

describe("decideOutbound", () => {
  it("allows an ordinary message under every limit", () => {
    expect(decideOutbound(facts(), limits)).toEqual({ decision: "ALLOWED" });
  });

  it("caps per person per hour and per day on each transport, never the security class", () => {
    expect(decideOutbound(facts({ sentLastHour: limits.EMAIL.perHour }), limits)).toEqual({ decision: "SUPPRESSED", reason: "CAPPED_HOURLY" });
    expect(decideOutbound(facts({ sentLastHour: 1, sentLastDay: limits.EMAIL.perDay }), limits)).toEqual({ decision: "SUPPRESSED", reason: "CAPPED_DAILY" });
    expect(decideOutbound(facts({ transport: "SMS", sentLastHour: limits.SMS.perHour }), limits)).toMatchObject({ reason: "CAPPED_HOURLY" });
    expect(decideOutbound(facts({ transport: "MOBILE_PUSH", sentLastHour: limits.SMS.perHour }), limits)).toEqual({ decision: "ALLOWED" });
    expect(decideOutbound(facts({ messageClass: "SECURITY", sentLastHour: 999, sentLastDay: 999 }), limits)).toEqual({ decision: "ALLOWED" });
  });

  it("drops an identical message for every class, security included", () => {
    expect(decideOutbound(facts({ duplicateRecently: true }), limits)).toEqual({ decision: "SUPPRESSED", reason: "DUPLICATE" });
    expect(decideOutbound(facts({ messageClass: "SECURITY", duplicateRecently: true }), limits)).toMatchObject({ reason: "DUPLICATE" });
  });

  it("applies the same type and subject window to normal and bulk messages, not urgent or security ones", () => {
    expect(decideOutbound(facts({ sameSubjectRecently: true }), limits)).toMatchObject({ reason: "SAME_SUBJECT" });
    expect(decideOutbound(facts({ messageClass: "BULK", sameSubjectRecently: true }), limits)).toMatchObject({ reason: "SAME_SUBJECT" });
    expect(decideOutbound(facts({ messageClass: "URGENT", sameSubjectRecently: true }), limits)).toEqual({ decision: "ALLOWED" });
  });

  it("honours pauses (type, person, subject) except for security and the safeguard alert itself", () => {
    expect(decideOutbound(facts({ pause: "TYPE" }), limits)).toMatchObject({ reason: "PAUSED_TYPE" });
    expect(decideOutbound(facts({ pause: "RECIPIENT" }), limits)).toMatchObject({ reason: "PAUSED_RECIPIENT" });
    expect(decideOutbound(facts({ pause: "SUBJECT", messageClass: "URGENT" }), limits)).toMatchObject({ reason: "PAUSED_SUBJECT" });
    expect(decideOutbound(facts({ pause: "RECIPIENT", messageClass: "SECURITY" }), limits)).toEqual({ decision: "ALLOWED" });
    expect(decideOutbound(facts({ pause: "RECIPIENT", messageClass: "ALERT" }), limits)).toEqual({ decision: "ALLOWED" });
  });

  it("emergency stop stops everything but security messages", () => {
    for (const messageClass of ["NORMAL", "URGENT", "BULK", "ALERT"] as const) {
      expect(decideOutbound(facts({ emergencyStop: true, messageClass }), limits)).toMatchObject({ reason: "EMERGENCY_STOP" });
    }
    expect(decideOutbound(facts({ emergencyStop: true, messageClass: "SECURITY" }), limits)).toEqual({ decision: "ALLOWED" });
  });

  it("limits safeguard alert emails per hour in total, and nothing else limits them", () => {
    expect(decideOutbound(facts({ messageClass: "ALERT", sentLastHour: 999 }), limits)).toEqual({ decision: "ALLOWED" });
    expect(decideOutbound(facts({ messageClass: "ALERT", alertEmailsLastHour: limits.alertEmailsPerHour }), limits)).toMatchObject({ reason: "ALERT_LIMIT" });
  });

  it("refuses disabled accounts except security messages", () => {
    expect(decideOutbound(facts({ recipientInactive: true }), limits)).toMatchObject({ reason: "INACTIVE_ACCOUNT" });
    expect(decideOutbound(facts({ recipientInactive: true, messageClass: "SECURITY" }), limits)).toEqual({ decision: "ALLOWED" });
  });

  it("holds or drops non-urgent staff messages in quiet hours; urgent, clients and released messages go", () => {
    expect(decideOutbound(facts({ inQuietHours: true }), limits)).toEqual({ decision: "HELD", reason: "QUIET_HOURS_HELD" });
    expect(decideOutbound(facts({ inQuietHours: true, holdable: false }), limits)).toMatchObject({ reason: "QUIET_HOURS" });
    expect(decideOutbound(facts({ inQuietHours: true, quietPolicy: "DROP" }), limits)).toMatchObject({ reason: "QUIET_HOURS" });
    expect(decideOutbound(facts({ inQuietHours: true, quietPolicy: "EXEMPT" }), limits)).toEqual({ decision: "ALLOWED" });
    expect(decideOutbound(facts({ inQuietHours: true, recipientIsStaff: false }), limits)).toEqual({ decision: "ALLOWED" });
    expect(decideOutbound(facts({ inQuietHours: true, releasedFromHold: true }), limits)).toEqual({ decision: "ALLOWED" });
  });

  it("decides quiet hours across midnight in local time", () => {
    const quiet = limits.quietHours;
    expect(isInQuietHours(21, 0, quiet)).toBe(true);
    expect(isInQuietHours(2, 30, quiet)).toBe(true);
    expect(isInQuietHours(6, 59, quiet)).toBe(true);
    expect(isInQuietHours(7, 0, quiet)).toBe(false);
    expect(isInQuietHours(20, 59, quiet)).toBe(false);
    expect(isInQuietHours(23, 0, { ...quiet, enabled: false })).toBe(false);
    expect(isInQuietHours(13, 0, { enabled: true, start: "12:00", end: "14:00" })).toBe(true);
  });

  it("says plainly that a suppressed message was not sent", () => {
    expect(notSentText("CAPPED_DAILY")).toBe("Not sent (sending safeguard): daily limit for this person reached.");
  });
});

describe("limits", () => {
  it("accepts the defaults and refuses values outside the safe bounds", () => {
    expect(limitsOutOfBounds(DEFAULT_SAFEGUARD_LIMITS)).toEqual([]);
    const tooLow = { ...DEFAULT_SAFEGUARD_LIMITS, EMAIL: { ...DEFAULT_SAFEGUARD_LIMITS.EMAIL, perHour: 1 } };
    expect(limitsOutOfBounds(tooLow).join(" ")).toMatch(/Email: Per person per hour must be a whole number from 5 to 60/);
    const dayBelowHour = { ...DEFAULT_SAFEGUARD_LIMITS, SMS: { ...DEFAULT_SAFEGUARD_LIMITS.SMS, perHour: 10, perDay: 8 } };
    expect(limitsOutOfBounds(dayBelowHour).join(" ")).toMatch(/daily limit cannot be lower/);
    expect(limitsOutOfBounds({ ...DEFAULT_SAFEGUARD_LIMITS, quietHours: { enabled: true, start: "9pm", end: "07:00" } }).join(" ")).toMatch(/Quiet hours start/);
  });

  it("clamps a stored row into bounds and falls back for junk", () => {
    const normalized = normalizeSafeguardLimits({ EMAIL: { perHour: 10_000, perDay: "x" }, breakerPerType: 1, quietHours: { start: "bad" } });
    expect(normalized.EMAIL.perHour).toBe(60);
    expect(normalized.EMAIL.perDay).toBe(60); // never below the hourly ceiling
    expect(normalized.breakerPerType).toBe(50);
    expect(normalized.quietHours).toEqual(DEFAULT_SAFEGUARD_LIMITS.quietHours);
  });
});

describe("classification", () => {
  it("names a send by its type, event key, subject, kind or category, in that order", () => {
    expect(deriveTypeKey({ typeKey: "job.qa_and_accountability", transport: "EMAIL" })).toBe("job.qa_and_accountability");
    expect(deriveTypeKey({ eventKey: "urgent_stock.open_need", transport: "EMAIL" })).toBe("stock.urgent_need");
    expect(deriveTypeKey({ subject: "Unfinished job reminder", transport: "WEB_PUSH" })).toBe("job.reminder.manual");
    expect(deriveTypeKey({ emailKind: "job_reminder", subject: "Something", transport: "EMAIL" })).toBe("email-kind:job_reminder");
    expect(deriveTypeKey({ category: "jobs", transport: "MOBILE_PUSH" })).toBe("category:jobs");
    expect(deriveTypeKey({ transport: "SMS" })).toBe("unclassified:sms");
  });

  it("classes security, alert, bulk and urgent types; catch-all keys are never paused as a type", () => {
    expect(messageClassFor("account.security")).toBe("SECURITY");
    expect(messageClassFor("anything", "SECURITY")).toBe("SECURITY");
    expect(messageClassFor("system.sending_safeguard")).toBe("ALERT");
    expect(messageClassFor("marketing.campaigns")).toBe("BULK");
    expect(messageClassFor("job.skipped_or_cancelled")).toBe("URGENT");
    expect(messageClassFor("job.qa_and_accountability")).toBe("NORMAL");
    expect(isPausableTypeKey("job.qa_and_accountability")).toBe(true);
    expect(isPausableTypeKey("email-kind:job_reminder")).toBe(false);
    expect(isPausableTypeKey("unclassified:sms")).toBe(false);
  });

  it("drops push and reminders at night, holds other email and SMS, exempts urgent", () => {
    expect(quietPolicyFor("job.qa_and_accountability", "NORMAL", "EMAIL")).toBe("HOLD");
    expect(quietPolicyFor("job.qa_and_accountability", "NORMAL", "MOBILE_PUSH")).toBe("DROP");
    expect(quietPolicyFor("job.reminder.unfinished_daily", "NORMAL", "EMAIL")).toBe("DROP");
    expect(quietPolicyFor("job.changed", "URGENT", "SMS")).toBe("EXEMPT");
  });
});
