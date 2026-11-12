/** Wording for maintenance.assignment: the in-app notice, the assignment email and the pay emails. */
import type { WordingPartDefinition } from "../types";
import { editable, inbox, line, part } from "./build";

const ASSIGNED_EMAIL = `<h2 style="margin:0 0 14px;font-family:Georgia,'Times New Roman',serif;font-size:26px;font-weight:600;color:#2f2b28;line-height:1.25;">You've been assigned to a maintenance item</h2>
<p style="margin:0 0 14px;font-family:Helvetica,Arial,sans-serif;font-size:14.5px;color:#2f2b28;">Hello {{userName}}, you have been added to the following maintenance item as <strong>{{roleLabel}}</strong>. It now appears in your portal.</p>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;margin:12px 0;background:#faf8f5;border:1px solid #e6e1da;border-radius:14px;">
  <tr>
    <td style="padding:16px 20px;">
      <div style="font-family:Georgia,'Times New Roman',serif;font-size:18px;font-weight:600;color:#2f2b28;line-height:1.3;">{{itemTitle}}</div>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;margin-top:10px;">{{detailRows}}</table>
    </td>
  </tr>
</table>
<p style="margin:18px 0 0;font-family:Helvetica,Arial,sans-serif;font-size:13px;color:#8a8580;">Other people may be assigned to this item in other roles. Please coordinate before attending.</p>`;

function payEmail(id: string, label: string, subject: string, sentence: string): WordingPartDefinition {
  return part(id, label, "EMAIL", { subject, body: `<p>Hi {{recipientName}},</p><p>${sentence}{{placeSuffix}}</p>{{noteParagraph}}<p>— {{companyName}}</p>` }, { required: ["itemTitle"] });
}

export const MAINTENANCE_WORDING = editable("maintenance.assignment", [
  inbox("assigned", "Assigned", "New maintenance job assigned", "{{propertyName}}: {{itemTitle}}", { required: ["itemTitle"], note: "In-app notice to the maintenance worker." }),
  part("assigned", "Assigned", "EMAIL", { subject: "Maintenance assigned — {{itemTitle}} ({{propertyName}}) · {{companyName}}", body: ASSIGNED_EMAIL }, { required: ["itemTitle"], note: "{{detailRows}} are the property, role, priority and schedule rows. The company header, footer and button are added around it." }),
  line("open-button", "Button label", "EMAIL", "Open maintenance item", "The button under the assignment email."),
  line("not-scheduled", "Not scheduled", "EMAIL", "Not scheduled yet", "Shown in the Scheduled row when there is no date."),
  payEmail("pay-changed", "Pay changed", "Your pay for this job has changed", "The pay for <strong>{{itemTitle}}</strong> is now {{pay}} (was {{previousPay}})."),
  payEmail("pay-set", "Pay set", "Pay set for your job", "<strong>{{itemTitle}}</strong> pays {{pay}}."),
  payEmail("price-approved", "Price approved", "Your price request was approved", "Your price for <strong>{{itemTitle}}</strong> was approved{{nowPays}}."),
  payEmail("price-declined", "Price declined", "Your price request was declined", "Your price request for <strong>{{itemTitle}}</strong> was not approved{{stillPays}}."),
  line("now-pays", "Now pays", "EMAIL", " — it now pays {{pay}}", "Added when the approved price is known."),
  line("still-pays", "Still pays", "EMAIL", ", so it still pays {{previousPay}}", "Added when there is an earlier agreed pay."),
  line("place-suffix", "Property", "EMAIL", " ({{place}})", "Added when the item has a property."),
  line("note-paragraph", "Office note", "EMAIL", "<p><strong>Note:</strong> {{note}}</p>", "Added when the office wrote a note."),
]);
