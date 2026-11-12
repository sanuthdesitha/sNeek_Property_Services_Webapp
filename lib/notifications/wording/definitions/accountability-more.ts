/** job.qa_and_accountability notices sent outside lib/notifications/accountability.ts. */
import type { TypeWordingDefinition, WordingPartDefinition } from "../types";
import { editable, inbox, line, part } from "./build";
import { ACCOUNTABILITY_PARTS } from "./accountability";

const BONUS_EMAIL = `<div style="font-family:Arial,sans-serif;color:#111;">
              <h2 style="margin:0 0 8px;">{{title}}</h2>
              <p style="color:#555;margin:0 0 12px;">{{summary}} All proposals are PENDING and must be approved before they reach payroll.</p>
              <p style="margin:16px 0;"><a href="{{actionUrl}}" style="display:inline-block;background:#111;color:#fff;text-decoration:none;padding:10px 16px;border-radius:8px;">Review bonus proposals</a></p>
            </div>`;

const MORE: readonly WordingPartDefinition[] = [
  inbox("bonus-proposals", "Bonus proposals to review", "{{companyName}}: {{count}} quality bonus {{proposalWord}} to review", "{{count}} accountability bonus {{proposalWord}} awaiting approval ({{streakCount}} streak, {{monthlyCount}} monthly) across {{cleanerCount}} {{cleanerWord}}.", { required: ["count"], note: "To the office. The title is also the email subject." }),
  part("bonus-proposals", "Bonus proposals to review", "EMAIL", { subject: "{{companyName}}: {{count}} quality bonus {{proposalWord}} to review", body: BONUS_EMAIL }, { required: ["summary"], note: "{{title}} and {{summary}} are the inbox title and body." }),
  inbox("rework-transfer", "Rework transfer to approve", "QA rework transfer awaiting approval", "{{propertyName}}: {{severity}} rework flagged by {{qaName}} — {{minutes}} min / {{amount}} proposed to move from {{cleanerName}}.", { required: ["propertyName"], note: "Push to the office." }),
  inbox("rework-recorded", "Rework recorded", "QA rework recorded on your job", "{{propertyName}}: QA flagged {{severity}} rework. {{moved}} moved to the QA inspector. Note: {{reason}}", { required: ["propertyName"], note: "To the cleaner; cut at 480 characters. {{moved}} is the minutes and/or amount." }),
  line("moved-joiner", "Minutes and amount joiner", "INBOX", " and ", "Joins the minutes and the amount in {{moved}}."),
  inbox("rework-declined", "Rework transfer declined", "QA rework transfer declined", "{{propertyName}}: A QA rework transfer against your job was declined by admin.", { required: ["propertyName"] }),
  inbox("offer-declined", "Rework offer declined", "Rework offer declined", "The original cleaner declined the rework offer — QA needs to reassign it.", { note: "Push to the office." }),
  inbox("offer-accepted", "Rework offer accepted", "Rework offer accepted", "The original cleaner accepted the rework — no pay and no deduction apply.", { note: "Push to the office." }),
  inbox("complete-form", "Complete your job form", "Complete your job form", "QA has started inspecting {{place}}. Please complete and submit your job form now.", { note: "To the cleaners when QA starts before the form is submitted; also a browser push." }),
  inbox("damage-refile", "Damage report to file again", "A damage report was sent back to you", "Your damage report needs to be filed again. Reason: {{reason}}", { required: ["reason"] }),
  inbox("damage-reopened", "Damage report reopened", "A damage report was sent back to you", "Your damage report was reopened so you can correct it. Reason: {{reason}}", { required: ["reason"] }),
];

export const QA_ACCOUNTABILITY_WORDING: TypeWordingDefinition = editable(
  "job.qa_and_accountability",
  [...ACCOUNTABILITY_PARTS, ...MORE],
  "The QA result email itself is the generated QA report (scores, issues and deductions); its inbox title, summary and SMS are editable here.",
);
