import { describe, expect, it } from "vitest";
import {
  LIFECYCLE_STAGES,
  LIFECYCLE_STAGE_LIST,
  renderLifecycleEmail,
} from "@/lib/notifications/lifecycle";

const CTX = {
  clientId: "cl_1",
  clientName: "Jackson",
  companyName: "sNeek Property Services",
  jobNumber: "1042",
  propertyName: "Jackson Property-11",
  serviceLabel: "Airbnb turnover",
  scheduledText: "Tue 5 Aug, 10:00am",
  notificationsEnabled: true,
} as any;

describe("CLEANER_REASSIGNED lifecycle stage", () => {
  it("is registered with a client-facing kind and no auto-send default", () => {
    const meta = LIFECYCLE_STAGES.CLEANER_REASSIGNED;
    expect(meta).toBeDefined();
    expect(meta.kind).toBe("client_job_update");
    // Never automatic: this email goes out only after a person reads it.
    expect(meta.autoDefault).toBe(false);
    expect(LIFECYCLE_STAGE_LIST.some((s) => s.stage === "CLEANER_REASSIGNED")).toBe(true);
  });

  it("leads with the CHANGE, not with the new name", () => {
    const { subject, html } = renderLifecycleEmail("CLEANER_REASSIGNED", CTX, {
      cleanerName: "Priya",
    });

    expect(subject.toLowerCase()).toContain("change");
    expect(html).toContain("Priya");
    // The point of a separate stage: it must not read like the original
    // "here is your cleaner" introduction.
    expect(subject).not.toBe(renderLifecycleEmail("CLEANER_ASSIGNED", CTX, {}).subject);
  });

  it("still reads sensibly when the replacement has no name yet", () => {
    const { html } = renderLifecycleEmail("CLEANER_REASSIGNED", CTX, {});
    expect(html).toContain("Another member of our team");
    expect(html).not.toContain("undefined");
    expect(html).not.toContain("null");
  });

  it("includes the reason only when one was given", () => {
    const withReason = renderLifecycleEmail("CLEANER_REASSIGNED", CTX, {
      cleanerName: "Priya",
      reason: "Sam is unwell.",
    });
    expect(withReason.html).toContain("Sam is unwell.");

    const withoutReason = renderLifecycleEmail("CLEANER_REASSIGNED", CTX, { cleanerName: "Priya" });
    // No empty paragraph where the explanation would have been.
    expect(withoutReason.html).not.toContain("<p></p>");
  });

  it("reassures that nothing else about the booking changed", () => {
    const { html } = renderLifecycleEmail("CLEANER_REASSIGNED", CTX, { cleanerName: "Priya" });
    expect(html).toContain("stays exactly the same");
  });
});
