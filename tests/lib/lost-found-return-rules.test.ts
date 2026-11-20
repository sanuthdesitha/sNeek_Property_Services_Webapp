/**
 * Lost and found return request rules (2026-11-20): fees stay unknown rather
 * than becoming $0, the handover attention is read from the live job and task,
 * the guest's preference wording, the cleaner's task text keeps the guest's
 * contact out unless shared, and the guest draft carries the link.
 */
import { describe, expect, it } from "vitest";
import {
  arrangementAttention,
  cleanerTaskText,
  describeConfiguredFee,
  describeFee,
  describeRequestChoice,
  draftDecisionMessage,
  fillAcknowledgementBody,
  fillTemplate,
  formatCalendarDate,
  parseFeeCents,
  timeWindowLabel,
  DEFAULT_ACK_BODY,
} from "@/lib/lost-found/return-rules";
import { draftLostFoundMessage } from "@/lib/lost-found/message";
import { lostFoundSettingsSchema, DEFAULT_LOST_FOUND_SETTINGS } from "@/lib/lost-found/settings";

describe("fees", () => {
  it("parses dollars and cents with string arithmetic; anything else is unknown, never 0", () => {
    expect(parseFeeCents("12")).toBe(1200);
    expect(parseFeeCents("12.5")).toBe(1250);
    expect(parseFeeCents("$12.05")).toBe(1205);
    expect(parseFeeCents("")).toBeNull();
    expect(parseFeeCents(null)).toBeNull();
    expect(parseFeeCents("abc")).toBeNull();
    expect(parseFeeCents("-3")).toBeNull();
    expect(parseFeeCents("1.234")).toBeNull();
  });

  it("describes not set, no fee and a quote in words", () => {
    expect(describeFee("NOT_SET", null, null)).toBe("Fee not set yet");
    expect(describeFee("QUOTED", null, null)).toBe("Fee not set yet");
    expect(describeFee("NO_FEE", null, null)).toBe("No fee");
    expect(describeFee("QUOTED", 1250, "Express Post")).toBe("$12.50 (Express Post)");
    expect(describeConfiguredFee({ text: null, cents: null })).toBeNull();
    expect(describeConfiguredFee({ text: "Tracked post", cents: null })).toBe("Tracked post");
    expect(describeConfiguredFee({ text: null, cents: 900 })).toBe("$9.00");
  });

  it("defaults the settings without inventing a fee, ack on (shown in Settings), clients recommend only", () => {
    expect(DEFAULT_LOST_FOUND_SETTINGS.postFee).toEqual({ text: null, cents: null });
    expect(DEFAULT_LOST_FOUND_SETTINGS.dropOffFee).toEqual({ text: null, cents: null });
    expect(DEFAULT_LOST_FOUND_SETTINGS.acknowledgement.enabled).toBe(true);
    expect(DEFAULT_LOST_FOUND_SETTINGS.clientsCanApproveReturns).toBe(false);
    expect(DEFAULT_LOST_FOUND_SETTINGS.upcomingCleans).toBe(3);
    expect(DEFAULT_LOST_FOUND_SETTINGS.linkDays).toBeNull();
    // A row saved before this change ({ holdingDays } only) still reads.
    expect(lostFoundSettingsSchema.parse({ holdingDays: 21 }).holdingDays).toBe(21);
  });
});

describe("arrangement attention", () => {
  const base = { status: "APPROVED" as const, confirmedDate: "2026-11-26", taskCleanerIds: ["c1"], hasTask: true, job: { status: "ASSIGNED", scheduledDay: "2026-11-26", cleanerIds: ["c1"] }, task: { executionStatus: "OPEN" } };
  it("is null while the clean, the day, the cleaner and the task are as approved", () => {
    expect(arrangementAttention(base)).toBeNull();
    expect(arrangementAttention({ ...base, status: "PENDING" })).toBeNull();
    expect(arrangementAttention({ ...base, hasTask: false })).toBeNull();
  });
  it("names what changed", () => {
    expect(arrangementAttention({ ...base, job: { ...base.job, status: "CANCELLED" } })).toBe("job_cancelled");
    expect(arrangementAttention({ ...base, job: null })).toBe("job_cancelled");
    expect(arrangementAttention({ ...base, job: { ...base.job, scheduledDay: "2026-11-27" } })).toBe("job_moved");
    expect(arrangementAttention({ ...base, job: { ...base.job, cleanerIds: ["c2"] } })).toBe("cleaner_changed");
    expect(arrangementAttention({ ...base, task: { executionStatus: "CANCELLED" } })).toBe("task_cancelled");
    expect(arrangementAttention({ ...base, task: { executionStatus: "NOT_COMPLETED" } })).toBe("task_not_done");
  });
});

describe("words", () => {
  it("offers broad windows and unshifted calendar dates", () => {
    expect(timeWindowLabel("09:30")).toBe("Morning");
    expect(timeWindowLabel("13:00")).toBe("Afternoon");
    expect(timeWindowLabel("18:00")).toBe("Evening");
    expect(timeWindowLabel(null)).toBe("Time to be confirmed");
    expect(formatCalendarDate("2026-11-26")).toBe("Thursday 26 November");
    expect(formatCalendarDate(null)).toBe("Date not set");
  });

  it("summarises a request without the address or contact", () => {
    expect(describeRequestChoice({ method: "PICKUP_AT_CLEAN", requestedDate: "2026-11-26", proposedTime: null, otherDetails: null })).toBe("Pick it up at the property during a clean (Thursday 26 November)");
    expect(describeRequestChoice({ method: "POST", requestedDate: null, proposedTime: null, otherDetails: null })).toBe("Post it to me");
  });

  it("keeps the guest's contact out of the cleaner's task unless the office shares it", () => {
    const hidden = cleanerTaskText({ itemName: "Charger", storageLocation: "Shelf B2", guestName: "Gina Guest", time: "11 am", date: "2026-11-26", contact: null, note: null });
    expect(hidden.title).toBe("Lost property handover: Charger");
    expect(hidden.description).toContain("Shelf B2");
    expect(hidden.description).toContain("Guest: Gina.");
    expect(hidden.description).not.toContain("Guest contact");
    expect(hidden.description).toMatch(/photo/i);
    const shared = cleanerTaskText({ itemName: "Charger", storageLocation: null, guestName: "Gina", time: null, date: null, contact: "0412 345 678", note: null });
    expect(shared.description).toContain("0412 345 678");
    expect(shared.description).toContain("ask the office (not recorded)");
  });

  it("drafts the decision message with the fee and link, and a decline with the reason", () => {
    const common = { guestName: "Gina Guest", itemName: "Charger", officeName: "sNeek", officePhone: "02 9000 0000", method: "PICKUP_AT_CLEAN" as const, confirmedDate: "2026-11-26", confirmedTime: "11 am", address: null, propertyLabel: "Bondi Studio, Bondi", feeLine: "Fee not set yet", note: null, link: "https://app.test/lost-found/t" };
    const approve = draftDecisionMessage({ ...common, decision: "approve" });
    expect(approve.body).toContain("Thursday 26 November, 11 am");
    expect(approve.body).toContain("Cost: Fee not set yet.");
    expect(approve.body).toContain("https://app.test/lost-found/t");
    const decline = draftDecisionMessage({ ...common, decision: "decline", note: "No cleans that week" });
    expect(decline.body).toContain("Reason: No cleans that week");
    expect(decline.body).toContain("choose another way here");
    const stay = { guestName: "Gina Guest", propertyName: "Bondi Studio", propertyAddress: "1 Sea St, Bondi, NSW 2026", checkIn: "2026-11-09", checkOut: "2026-11-12" };
    const block = "Your stay\nGuest: Gina Guest\nStay: 9 November 2026 to 12 November 2026\nProperty: Bondi Studio, 1 Sea St, Bondi, NSW 2026";
    expect(draftDecisionMessage({ ...common, decision: "approve", stay }).body).toContain(block);
    expect(draftDecisionMessage({ ...common, decision: "decline", note: "No cleans", stay }).body).toContain(block);
    expect(approve.body).not.toContain("Your stay");
  });

  it("fills the acknowledgement template and says it is not confirmed", () => {
    const filled = fillTemplate(DEFAULT_ACK_BODY, { guestFirstName: "Gina", itemName: "charger", choice: "Post it to me", officeName: "sNeek", link: "https://app.test/lost-found/t" });
    expect(filled).toContain("Hi Gina");
    expect(filled).toContain("not confirmed yet");
    expect(filled).toContain("https://app.test/lost-found/t");
    expect(fillTemplate("{{unknown}}x", {})).toBe("x");
  });

  it("always puts the stay details in the acknowledgement, and leaves no gap when none are recorded", () => {
    const values = { guestFirstName: "Gina", itemName: "charger", choice: "Post it to me", officeName: "sNeek", link: "https://app.test/lost-found/t" };
    const stay = { guestName: "Gina Guest", propertyName: "Bondi Studio", propertyAddress: "1 Sea St, Bondi, NSW 2026", checkIn: "2026-11-09", checkOut: "2026-11-12" };
    const withDefault = fillAcknowledgementBody(DEFAULT_ACK_BODY, values, stay);
    expect(withDefault).toContain("Stay: 9 November 2026 to 12 November 2026");
    expect(withDefault.match(/Your stay/g)).toHaveLength(1);
    const custom = fillAcknowledgementBody("Hi {{guestFirstName}},\n\nGot it.\n\n{{officeName}}", values, stay);
    expect(custom).toBe("Hi Gina,\n\nYour stay\nGuest: Gina Guest\nStay: 9 November 2026 to 12 November 2026\nProperty: Bondi Studio, 1 Sea St, Bondi, NSW 2026\n\nGot it.\n\nsNeek");
    expect(fillAcknowledgementBody(DEFAULT_ACK_BODY, values, stay, "compact")).toContain("Your stay: Gina Guest; 9 Nov 2026 to 12 Nov 2026; Bondi Studio, 1 Sea St, Bondi, NSW 2026.");
    const none = fillAcknowledgementBody(DEFAULT_ACK_BODY, values, null);
    expect(none).not.toContain("Your stay");
    expect(none).not.toMatch(/\n{3,}/);
  });

  it("puts the guest link in the office's Message guest draft, and the portal link in Tell client", () => {
    const input = { itemName: "Charger", foundAt: "2026-11-10T01:00:00.000Z", foundLocation: null, propertyName: "Bondi", propertyAddress: null, guestName: "Gina", clientName: "Ann", officeName: "sNeek", officePhone: null, timeZone: "Australia/Sydney" };
    expect(draftLostFoundMessage({ ...input, audience: "guest", guestLinkUrl: "https://app.test/lost-found/t" }).body).toContain("View your item and request its return here: https://app.test/lost-found/t");
    expect(draftLostFoundMessage({ ...input, audience: "guest" }).body).toContain("Please reply");
    const stay = { guestName: "Gina Guest", propertyName: "Bondi", propertyAddress: "1 Sea St, Bondi, NSW 2026", checkIn: "2026-11-09", checkOut: null };
    expect(draftLostFoundMessage({ ...input, audience: "guest", stay }).body).toContain("Your stay\nGuest: Gina Guest\nStay: from 9 November 2026\nProperty: Bondi, 1 Sea St, Bondi, NSW 2026");
    expect(draftLostFoundMessage({ ...input, audience: "client", stay }).body).not.toContain("Your stay");
    expect(draftLostFoundMessage({ ...input, audience: "client", clientLinkUrl: "https://app.test/v2/client/lost-found" }).body).toContain("https://app.test/v2/client/lost-found");
  });
});
