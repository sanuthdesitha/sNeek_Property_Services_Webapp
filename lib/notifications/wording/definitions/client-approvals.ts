/** client.approvals and account.invitations: templates plus the routes' own sentences. */
import type { WordingPartDefinition } from "../types";
import { emailTemplatePart, inbox, line, part } from "./build";

const PAY_APPROVAL_EMAIL = `
          <p>An approval is required for <strong>{{propertyName}}</strong>.</p>
          <p><strong>{{approvalTitle}}</strong></p>
          <p>Amount: {{amount}}</p>
          {{descriptionParagraph}}
          <p>Review here: <a href="{{approvalUrl}}">{{approvalUrl}}</a></p>
        `;

const ASSISTANT_EMAIL = `
            <p>We have set up portal access for the following {{assistantWord}}, on the team <strong>{{teamName}}</strong>:</p>
            <ul>{{assistantItems}}</ul>
            {{grantParagraph}}
            <p>Manage their access here: <a href="{{manageUrl}}">{{manageUrl}}</a></p>
            <p>Assistants can never approve quotes or extras, approve costs, or pay invoices. Those stay with you.</p>
          `;

export const CLIENT_APPROVAL_PARTS: readonly WordingPartDefinition[] = [
  emailTemplatePart("client", "Client", "quoteApprovalRequest"),
  inbox("approval-required", "Approval required (inbox)", "Approval required", "{{placeName}}: {{approvalTitle}}", { required: ["approvalTitle"], note: "To the client's logins; {{placeName}} is the client or property name." }),
  line("description-paragraph", "Description", "EMAIL", "<p>{{description}}</p>", "Added when the approval has a description."),
  part("pay-approval", "Pay approval email", "EMAIL", { subject: "{{companyName}} - Approval required", body: PAY_APPROVAL_EMAIL }, { required: ["approvalUrl"], note: "Sent when the office asks the client to approve a pay item." }),
];

export const INVITATION_PARTS: readonly WordingPartDefinition[] = [
  emailTemplatePart("invite", "Invitation", "accountInvite"),
  emailTemplatePart("welcome", "Welcome", "welcomeAccount"),
  line("button-complete-setup", "Button: complete setup", "INBOX", "Sign in and complete setup", "Button label when a new client is invited."),
  line("button-set-password", "Button: set password", "INBOX", "Sign in and set your password", "Button label when a client is re-invited or a lead becomes a client."),
  part("assistants-added", "Assistants added (client)", "EMAIL", { subject: "{{companyName}} - assistant access added to your account", body: ASSISTANT_EMAIL }, { required: ["manageUrl"], note: "{{assistantItems}} lists the invited assistants." }),
  line("grant-new-team", "New team permissions", "EMAIL", "<p>You can change what they are allowed to do at any time.</p>", "Used as {{grantParagraph}} when a new team was created."),
  line("grant-existing-team", "Existing team permissions", "EMAIL", "<p>They inherit the permissions already set on that team.</p>", "Used as {{grantParagraph}} for an existing team."),
];
