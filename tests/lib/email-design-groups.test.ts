// @vitest-environment node
/**
 * The groups moved in the second pass keep their facts and values:
 * lifecycle stages, booking decisions, finance events, Monthly Insights and
 * plain office messages; plus the editor's custom-HTML rules.
 */
import { describe, expect, it } from "vitest";
import { renderLifecycleEmail, LIFECYCLE_STAGE_LIST, type LifecycleStage } from "@/lib/notifications/lifecycle";
import { FINANCE_EVENTS } from "@/lib/notifications/events";
import { findEmailDesign } from "@/lib/email-design/all-designs";
import { blockingChecks, checkDocument } from "@/lib/email-design/checks";
import { buildDesignedEmail, plainMessageEmail } from "@/lib/email-design/build-email";
import { businessFromSettings, composeDesign } from "@/lib/email-design/compose";
import { extractSpec } from "@/lib/email-design/spec";
import { htmlWords } from "@/lib/email-design/convert-html";
import { DEFAULT_EMAIL_THEME } from "@/lib/email-design/theme";
import { financeDesignKey } from "@/lib/email-design/catalog/finance";
import { getDefaultNotificationTemplates } from "@/lib/notification-templates";

const settings = { companyName: "sNeek Property Services" };
const words = (html: string) => new Set(htmlWords(html).map((word) => word.toLowerCase()));
const lost = (before: string, after: string) => { const kept = words(after); return htmlWords(before).map((word) => word.toLowerCase()).filter((word) => !kept.has(word)); };
const ctx = { companyName: "sNeek Property Services", clientId: "c1", clientName: "Priya Natarajan", jobId: "j1", jobNumber: 1042, propertyName: "The Bondi Studio", serviceLabel: "Airbnb turnover", scheduledText: "Thu 12 Nov, 10:00 am", portalUrl: "https://app.example.invalid/v2/client", notificationsEnabled: true };

describe("lifecycle stages", () => {
  const stages = LIFECYCLE_STAGE_LIST.map((meta) => meta.stage);
  it.each(stages)("%s keeps every word, the subject and the button", (stage) => {
    const extra = { reason: "Guests stayed on", cleanerName: "Jane Doe", amount: 742.5, bodyHtml: stage === "CUSTOM" || stage === "REPORT_READY" ? "<p>Our note &amp; details</p>" : undefined, subject: stage === "CUSTOM" ? "A note from the office" : undefined };
    const rendered = renderLifecycleEmail(stage as LifecycleStage, ctx, extra);
    const { spec, html } = extractSpec(rendered.designHtml);
    expect(spec?.key).toBe(`lifecycle.${stage}`);
    const definition = findEmailDesign(`lifecycle.${stage}`)!;
    expect(blockingChecks(checkDocument(definition, definition.defaults, DEFAULT_EMAIL_THEME))).toEqual([]);
    expect(lost(rendered.html, html)).toEqual([]);
    const sent = composeDesign(definition, definition.defaults, spec!.values, { theme: DEFAULT_EMAIL_THEME, business: businessFromSettings(settings), appUrl: "https://app.example.invalid", mode: "send", settings });
    expect(sent.subject).toBe(rendered.subject);
    if (stage === "INVOICE_ISSUED") expect(sent.html).toContain("$742.50");
  });

  it("an unedited reassign body sends the design; a rewritten one goes as written", () => {
    const rendered = renderLifecycleEmail("CLEANER_REASSIGNED", ctx, { cleanerName: "Jane" });
    expect(rendered.html).not.toContain("sneek-email-spec");
    expect(rendered.designHtml).toContain("sneek-email-spec");
  });
});

describe("booking decisions", () => {
  it("confirmed and declined keep their words and escape values", () => {
    const yes = buildDesignedEmail(settings, "bookingConfirmed", { clientName: "Jo <b>", service: "deep clean", placeSuffix: " at Manly Loft", scheduledDate: "Fri 13 Nov", requestedDate: "Thu 12 Nov" });
    expect(yes.subject).toBe("sNeek Property Services — your booking is confirmed");
    expect(yes.html).toContain("Hello Jo &lt;b&gt;,");
    expect(yes.html).toContain("deep clean at Manly Loft is confirmed for");
    expect(yes.html).toContain("You asked for Thu 12 Nov");
    const no = buildDesignedEmail(settings, "bookingDeclined", { clientName: "Jo", service: "deep clean", placeSuffix: "", onDate: " on Fri 13 Nov", reason: "Fully booked" });
    expect(no.html).toContain("we could not take your deep clean on Fri 13 Nov.");
    expect(no.html).toContain("Fully booked");
    const noMove = buildDesignedEmail(settings, "bookingConfirmed", { clientName: "Jo", service: "clean", placeSuffix: "", scheduledDate: "Fri 13 Nov", requestedDate: "" });
    expect(noMove.html).not.toContain("You asked for");
  });
});

describe("finance events", () => {
  it("every finance event is a design whose version 1 is its standard wording", () => {
    const defaults = getDefaultNotificationTemplates() as Record<string, { webSubject?: string; webBody?: string }>;
    for (const event of FINANCE_EVENTS) {
      const definition = findEmailDesign(financeDesignKey(event.key));
      expect(definition, event.key).not.toBeNull();
      expect(blockingChecks(checkDocument(definition!, definition!.defaults))).toEqual([]);
      const values = Object.fromEntries(event.variables.map((name) => [name, `X${name}`]));
      const rendered = composeDesign(definition!, definition!.defaults, values, { theme: DEFAULT_EMAIL_THEME, business: businessFromSettings(settings), appUrl: "https://app.example.invalid", mode: "send", settings });
      const standard = defaults[event.key];
      if (standard?.webSubject) expect(rendered.subject).toBe(standard.webSubject.replace(/\{([a-zA-Z0-9_]+)\}/g, (_m, name: string) => `X${name}`));
    }
  });
});

describe("plain office messages", () => {
  it("escape the text, keep line breaks and add the greeting only when asked", () => {
    const message = plainMessageEmail({ subject: "Roster", text: "Line one\n<script>x</script>", greetingName: "Jane" });
    const { html } = extractSpec(message.html);
    expect(message.subject).toBe("Roster");
    expect(html).toContain("Hi Jane,");
    expect(html).toContain("Line one<br>&lt;script&gt;x&lt;/script&gt;");
    expect(extractSpec(plainMessageEmail({ subject: "s", text: "t" }).html).html).not.toContain("Hi ");
  });
});

describe("Monthly Insights", () => {
  it("is a design with the figures as built content and a test-send note only on tests", () => {
    const test = buildDesignedEmail(settings, "insightsMonthly", { greeting: "Hi Hannah,", periodLabel: "October 2026", sectionsHtml: "<table><tr><td>Cleans done</td><td>42</td></tr></table>", sectionsText: "Cleans done: 42", testNote: "Test send to you only.", insightsUrl: "https://app.example.invalid/v2/admin/insights", subjectPrefix: "Test: " });
    expect(test.subject).toBe("Test: sNeek Property Services business summary: October 2026");
    expect(test.html).toContain("Cleans done");
    expect(test.html).toContain("Test send to you only.");
  });
});
