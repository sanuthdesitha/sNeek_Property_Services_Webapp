// @vitest-environment node
/**
 * One set of message template names (owner default 2026-11-17): client
 * automations fill the dotted names and keep the old snake_case names as
 * aliases (existing templates keep working); the editor warns when a place
 * cannot fill a name and replaces the old names in one click.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  applyTemplateFilter,
  canFill,
  renderAutomationTemplate,
  replaceLegacyNames,
  replaceableLegacyNames,
  smsLength,
  unfilledNames,
} from "@/lib/messages/template-variables";
import { audienceCategoryFilter, audienceForRecipient } from "@/lib/messages/template-audience";

describe("template names", () => {
  const legacy = { client_name: "Priya Shah", cleaner_name: "Marco Rossi", next_clean_date: "18 Nov 2026", feedback_url: "https://x/f" };
  const scheduled = new Date(2026, 10, 18, 10, 0);
  const dotted = { "client.firstName": "Priya", "cleaner.firstName": "Marco", "job.scheduledFor": scheduled, "property.name": "Glebe House" };

  it("still fills the old names in automations", () => {
    expect(renderAutomationTemplate("Hi {{client_name}}, {{ cleaner_name }} comes {{next_clean_date}}. {{feedback_url}}", {}, legacy)).toBe(
      "Hi Priya Shah, Marco Rossi comes 18 Nov 2026. https://x/f",
    );
  });

  it("fills the dotted names (with filters) in automations, as the inbox does", () => {
    expect(renderAutomationTemplate("Hi {{client.firstName}}: {{property.name}} {{job.scheduledFor | date short}} at {{job.scheduledFor | time}}", dotted, legacy)).toBe(
      "Hi Priya: Glebe House Wed 18 Nov at 10:00 AM",
    );
    expect(renderAutomationTemplate("{{quote.totalAmount | currency}}|{{unknown_name}}", dotted, legacy)).toBe("|");
  });

  it("keeps the inbox filters exactly as before and adds the date day form used by the replacement", () => {
    expect(applyTemplateFilter(scheduled, "date short")).toBe("Wed 18 Nov");
    expect(applyTemplateFilter(scheduled, "date day")).toBe("18 Nov 2026");
    expect(applyTemplateFilter(1234.5, "currency")).toBe("$1,234.50");
    expect(applyTemplateFilter(null, "date short")).toBe("");
  });

  it("knows what each place fills", () => {
    expect(canFill("automation", "client_name")).toBe(true);
    expect(canFill("automation", "client.firstName")).toBe(true);
    expect(canFill("automation", "quote.totalAmount")).toBe(false);
    expect(canFill("inbox", "client_name")).toBe(false);
    expect(canFill("inbox", "client.firstName")).toBe(true);
    expect(canFill("inbox", "property.name")).toBe(false);
    expect(canFill("composer", "property.name")).toBe(true);
    expect(canFill("campaign", "job.scheduledFor")).toBe(false);
  });

  it("warns per place and replaces the old names in one go (feedback_url has no equivalent and stays)", () => {
    const body = "Hi {{client_name}}, your cleaner is {{cleaner_name}}. {{feedback_url}}";
    expect(unfilledNames([body], ["inbox", "automation"])).toEqual([{ destination: "inbox", names: ["client_name", "cleaner_name", "feedback_url"] }]);
    expect(replaceableLegacyNames(body)).toEqual(["client_name", "cleaner_name"]);
    expect(replaceLegacyNames(body)).toBe("Hi {{client.name}}, your cleaner is {{cleaner.name}}. {{feedback_url}}");
    expect(replaceLegacyNames("{{next_clean_date}}")).toBe("{{job.scheduledFor | date day}}");
  });

  it("counts SMS characters and texts", () => {
    expect(smsLength("a".repeat(142))).toEqual({ characters: 142, texts: 1 });
    expect(smsLength("a".repeat(161))).toEqual({ characters: 161, texts: 2 });
  });

  it("gives cleaners and laundry partners their own insert list", () => {
    expect(audienceCategoryFilter("cleaner")).toEqual({ in: ["CLEANER_FACING"] });
    expect(audienceCategoryFilter("laundry")).toEqual({ in: ["LAUNDRY_FACING"] });
    expect(audienceCategoryFilter("client")).toEqual({ notIn: ["CLEANER_FACING", "LAUNDRY_FACING", "INTERNAL"] });
    expect(audienceCategoryFilter(null)).toBeUndefined();
    expect(audienceForRecipient({ kind: "user", role: "CLEANER" })).toBe("cleaner");
    expect(audienceForRecipient({ kind: "user", role: "LAUNDRY" })).toBe("laundry");
    expect(audienceForRecipient({ kind: "client" })).toBe("client");
    expect(audienceForRecipient({ kind: "user", role: "ADMIN" })).toBeNull();
  });
});

const m = vi.hoisted(() => ({ job: vi.fn(), sendEmail: vi.fn(), sendSms: vi.fn(), notification: vi.fn() }));
vi.mock("@/lib/db", () => ({
  db: {
    job: { findUnique: m.job },
    jobFeedback: { upsert: vi.fn(async () => ({ token: "tok" })) },
    notification: { create: m.notification },
    client: { update: vi.fn() },
  },
}));
vi.mock("@/lib/notifications/email", () => ({ sendEmailDetailed: m.sendEmail }));
vi.mock("@/lib/notifications/sms", () => ({ sendSmsDetailed: m.sendSms }));
vi.mock("@/lib/app-url", () => ({ resolveAppUrl: (path: string) => `https://app.test${path}` }));
vi.mock("@/lib/notifications/wording/render", () => ({
  loadNotificationWording: async () => ({
    line: () => "Default subject",
    render: (_part: string, _transport: string, values: { subject: string; messageHtml: string }) => ({ subject: values.subject, html: values.messageHtml }),
  }),
}));

import { dispatchClientPostJobAutomations } from "@/lib/notifications/client-automation";

function job(templateBody: string) {
  return {
    id: "job1",
    jobNumber: "J-1031",
    jobType: "AIRBNB_TURNOVER",
    scheduledDate: new Date(2026, 10, 18, 10, 0),
    property: {
      id: "p1",
      name: "Glebe House",
      address: "1 Glebe Point Rd",
      suburb: "Glebe",
      client: {
        id: "c1",
        name: "Northside Lets",
        email: "office@northside.test",
        phone: null,
        lastReviewRequestSentAt: null,
        users: [{ id: "u1", name: "Priya", email: "priya@northside.test", phone: null }],
        automationRules: [{ id: "r1", triggerType: "POST_JOB_NEXT_CLEAN", jobType: null, channel: "EMAIL", template: { isActive: true, subject: "Next clean: {{property_name}}", body: templateBody } }],
      },
    },
    assignments: [{ isPrimary: true, user: { id: "cl1", name: "Marco Rossi", phone: null } }],
    feedback: null,
  };
}

describe("client automations send both name sets", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    m.sendEmail.mockResolvedValue({ ok: true, externalId: "e1" });
  });

  it("an existing snake_case template sends exactly as before", async () => {
    m.job.mockResolvedValue(job("Hi {{client_name}}, {{cleaner_name}} is booked for {{next_clean_date}} ({{job_type}}). Rate us: {{feedback_url}}"));
    await dispatchClientPostJobAutomations("job1");
    const sent = m.sendEmail.mock.calls[0][0];
    expect(sent.subject).toBe("Next clean: Glebe House");
    expect(sent.html).toBe("Hi Northside Lets, Marco Rossi is booked for 18 Nov 2026 (AIRBNB TURNOVER). Rate us: https://app.test/feedback/tok");
  });

  it("a dotted template is filled by the automation too", async () => {
    m.job.mockResolvedValue(job("Hi {{client.firstName}}, {{cleaner.firstName}} comes {{job.scheduledFor | date short}} to {{property.name}}."));
    await dispatchClientPostJobAutomations("job1");
    expect(m.sendEmail.mock.calls[0][0].html).toBe("Hi Northside, Marco comes Wed 18 Nov to Glebe House.");
  });
});
