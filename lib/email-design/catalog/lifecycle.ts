/**
 * Client lifecycle emails (lib/notifications/lifecycle.ts) as blocks, one per
 * stage. Version 1 keeps each stage's words; the code still decides when a
 * stage is sent and works out the phrases ("for Fri 13 Nov", " at Bondi").
 * Plain module.
 */
import { button, design, doc, paragraph, v } from "./build";
import type { EmailDesignDefinition } from "../types";

/** Values every lifecycle email gets (worked out by lifecycle.ts, empty when they don't apply). */
export const LIFECYCLE_VARIABLES = [
  v("firstName", "Client first name", "Priya", { fallback: "there" }),
  v("service", "Service (“Deep clean clean” or “clean”)", "Airbnb turnover clean", { fallback: "" }),
  v("place", "“ at <property>” when known", " at The Bondi Studio", { fallback: "" }),
  v("refSuffix", "“ #<job number>” when known", " #1042", { fallback: "" }),
  v("when", "When", "Thu 12 Nov, 10:00 am", { fallback: "" }),
  v("forWhen", "“ for <when>” when known", " for Thu 12 Nov, 10:00 am", { fallback: "" }),
  v("onWhen", "“ on <when>” when known", " on Thu 12 Nov, 10:00 am", { fallback: "" }),
  v("forWhenOrSoon", "“ for <when>”, or “ soon”", " for Thu 12 Nov, 10:00 am", { fallback: "" }),
  v("scheduledFor", "“ scheduled for <when>” when known", " scheduled for Thu 12 Nov", { fallback: "" }),
  v("cleanerName", "Cleaner", "Jane Doe", { fallback: "" }),
  v("reason", "Reason or note", "", { format: "multiline", fallback: "" }),
  v("amount", "Amount due (from the invoice)", "$742.50", { fallback: "" }),
  v("skipWord", "“cancelled” or “skipped”", "skipped", { fallback: "" }),
  v("bodyHtml", "Body written by the sender (report or custom message)", "", { format: "built", fallback: "" }),
  v("customSubject", "Subject written by the sender", "An update on your clean", { fallback: "" }),
  v("actionUrl", "Button link (portal, report or invoice)", "https://app.sneek.example/v2/client", { format: "url", fallback: "" }),
  v("actionLabel", "Button label (from the sender)", "", { fallback: "" }),
];

const TAIL = [button("View in your portal", "actionUrl", { labelValue: "actionLabel" }), paragraph("Warm regards,\nThe {{companyName}} team")];

type Stage = { stage: string; label: string; subject: string; body: string[]; trigger: string };

const STAGES: Stage[] = [
  { stage: "BOOKING_CONFIRMED", label: "Booking confirmed", trigger: "A clean is booked.", subject: "{{companyName}}: Your {{service}} is booked{{refSuffix}}", body: ["Your {{service}}{{place}} is confirmed{{forWhen}}.", "We'll keep you posted at every step — you'll get a heads-up when your cleaner is on the way."] },
  { stage: "SCHEDULE_UPDATED", label: "Schedule changed", trigger: "The date or time of a clean changes.", subject: "{{companyName}}: Your clean has been rescheduled{{refSuffix}}", body: ["The schedule for your {{service}}{{place}} has been updated.", "**New time:** {{when}}|when", "{{reason}}|reason"] },
  { stage: "REMINDER", label: "Upcoming clean reminder", trigger: "Before an upcoming clean.", subject: "{{companyName}}: Reminder — your clean is coming up", body: ["Just a reminder that your {{service}}{{place}} is scheduled{{forWhenOrSoon}}.", "Please make sure our team can access the property. Reply if anything's changed."] },
  { stage: "CLEANER_ASSIGNED", label: "Cleaner assigned", trigger: "A cleaner is assigned (sent by the office).", subject: "{{companyName}}: Your cleaner is assigned", body: ["**{{cleanerName}}** will be looking after your {{service}}{{place}}{{onWhen}}."] },
  { stage: "CLEANER_REASSIGNED", label: "Cleaner changed", trigger: "The office changes the cleaner and chooses to tell the client.", subject: "{{companyName}}: A change to who's cleaning for you", body: ["We've had to change the cleaner for your {{service}}{{place}}{{onWhen}}.", "**{{cleanerName}}** will be looking after it instead.", "{{reason}}|reason", "Everything else — the time, the access arrangements and the standard of the clean — stays exactly the same. Just reply if you'd like to talk it through."] },
  { stage: "JOB_COMPLETED", label: "Clean completed", trigger: "A clean is finished.", subject: "{{companyName}}: Your clean is complete", body: ["Great news — your {{service}}{{place}} is complete.", "Your report will follow shortly. Thank you for choosing {{companyName}}."] },
  { stage: "REPORT_READY", label: "Report ready", trigger: "A clean report is shared.", subject: "{{companyName}}: Your clean report is ready", body: ["Your report for the {{service}}{{place}}{{onWhen}} is ready.", "{{bodyHtml}}|bodyHtml"] },
  { stage: "INVOICE_ISSUED", label: "Invoice issued", trigger: "An invoice for a clean is sent.", subject: "{{companyName}}: Invoice for your clean{{refSuffix}}", body: ["Please find your invoice for the {{service}}{{place}}{{onWhen}}.", "**Amount due:** {{amount}}|amount"] },
  { stage: "ISSUE_RAISED", label: "Issue raised", trigger: "Quality found something to put right (sent by the office).", subject: "{{companyName}}: We're following up on your clean", body: ["During our quality check on your {{service}}{{place}} we spotted something we want to put right.", "{{reason}}|reason", "We'll be in touch to arrange a re-clean at no extra cost."] },
  { stage: "RECLEAN_SCHEDULED", label: "Re-clean scheduled", trigger: "A re-clean is booked.", subject: "{{companyName}}: Your re-clean is scheduled", body: ["We've scheduled a complimentary re-clean{{place}}{{forWhen}} to make sure everything is perfect.", "{{reason}}|reason"] },
  { stage: "SKIP_CANCELLED", label: "Skipped / cancelled", trigger: "A clean is skipped or cancelled.", subject: "{{companyName}}: Your clean has been {{skipWord}}", body: ["Your {{service}}{{place}}{{scheduledFor}} has been {{skipWord}}.", "{{reason}}|reason", "Get in touch any time to rebook."] },
  { stage: "CUSTOM", label: "Custom message", trigger: "The office writes a message to the client.", subject: "{{customSubject}}", body: ["{{bodyHtml}}|bodyHtml", "{{reason}}|reason"] },
];

export function lifecycleDesignKey(stage: string): string {
  return `lifecycle.${stage}`;
}

export const LIFECYCLE_DESIGNS: readonly EmailDesignDefinition[] = STAGES.map((stage) => design({
  key: lifecycleDesignKey(stage.stage),
  label: `Client: ${stage.label}`,
  group: "clients",
  typeKey: "client.lifecycle_email",
  audience: "Client contacts",
  trigger: stage.trigger,
  security: false,
  whyLine: "You got this because you're a client of sNeek.",
  preferences: "client",
  allowedBlocks: ["heading", "paragraph", "details", "lineItems", "callout", "button", "divider", "signature", "note"],
  mustStay: [],
  source: `lib/notifications/lifecycle.ts (${stage.stage}, HTML in code)`,
  titleOptional: true,
  variables: LIFECYCLE_VARIABLES,
  defaults: doc(stage.subject, "", [
    paragraph("Hi {{firstName}},"),
    ...stage.body.map((line) => {
      const [text, showIf] = line.split("|");
      if (text === "{{bodyHtml}}") return { type: "lineItems" as const, source: "bodyHtml", ...(showIf ? { showIf } : {}) };
      return paragraph(text, showIf ? { showIf } : {});
    }),
    ...TAIL,
  ]),
}));
