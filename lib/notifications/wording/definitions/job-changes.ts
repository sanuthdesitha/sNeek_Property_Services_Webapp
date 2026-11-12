/**
 * job.changed: the job-edit notice (shared in-app/SMS template plus its email),
 * the reset notice, the reschedule notice and the job-task notices
 * (lib/job-tasks/service.ts). Defaults are the producers' text byte for byte.
 */
import type { WordingPartDefinition } from "../types";
import { editable, inbox, line, notificationTemplateParts, part } from "./build";

function three(id: string, label: string, title: string, body: string, emailSubject: string, emailBody: string, sms: string, required: readonly string[], note?: string): WordingPartDefinition[] {
  return [
    inbox(id, label, title, body, { required, note }),
    part(id, label, "EMAIL", { subject: emailSubject, body: emailBody }, { required }),
    part(id, label, "SMS", { body: sms }, { required }),
  ];
}

const UPDATED_EMAIL = `
          <h2 style="margin:0 0 12px;">Job updated{{attentionSuffix}}</h2>
          <p><strong>{{jobNumber}}</strong> for <strong>{{propertyName}}</strong> has been updated.</p>
          <ul style="padding-left:18px;margin:12px 0;">{{changeList}}</ul>
          <p>Open the job for the latest instructions and schedule details.</p>
        `;

const TASKS_EMAIL = `
        <h2 style="margin:0 0 12px;">Extra {{taskWord}} added</h2>
        <p><strong>{{jobNumber}}</strong> at <strong>{{propertyName}}</strong> now includes:</p>
        <ul style="padding-left:18px;margin:12px 0;">{{taskList}}</ul>
        <p>Open the job before you start so you have the full list.</p>
      `;

const CLIENT_TASK_EMAIL = `
        <p>A client task request needs approval.</p>
        <p><strong>Job:</strong> {{jobNumber}}</p>
        <p><strong>Property:</strong> {{propertyName}}</p>
        <p><strong>Task:</strong> {{taskTitle}}</p>
        <p><a href="{{actionUrl}}">Review job</a></p>
      `;

const CLIENT_REQUEST_EMAIL = `
        <p>{{requestTitle}}.</p>
        <p><strong>Job:</strong> {{jobNumber}}</p>
        <p><strong>Property:</strong> {{propertyName}}</p>
        {{noteParagraph}}
        <p><a href="{{actionUrl}}">Open job</a></p>
      `;

function decisionEmail(sentence: string): string {
  return `
          <p>${sentence}</p>
          <p><strong>Task:</strong> {{taskTitle}}</p>
          <p><strong>Job:</strong> {{jobNumber}}</p>
          <p><strong>Property:</strong> {{propertyName}}</p>
          {{noteParagraph}}
          <p><a href="{{actionUrl}}">Open</a></p>
        `;
}

const AUTO_APPROVED_EMAIL = `
          <p>A client job task was auto-approved because no admin decision was made before the deadline.</p>
          <p><strong>Task:</strong> {{taskTitle}}</p>
          <p><strong>Job:</strong> {{jobNumber}}</p>
          <p><strong>Property:</strong> {{propertyName}}</p>
        `;

const NOT_COMPLETED_EMAIL = `
            <p>A cleaner marked a job task as not completed.</p>
            <p><strong>Task:</strong> {{taskTitle}}</p>
            <p><strong>Job:</strong> {{jobNumber}}</p>
            <p><strong>Property:</strong> {{propertyName}}</p>
            {{reasonParagraph}}
            <p><a href="{{actionUrl}}">Review job</a></p>
          `;

const CLIENT_ASKED = (id: string, label: string, title: string) => [
  inbox(id, label, title, "{{jobNumber}} at {{propertyName}}{{noteQuote}}", { required: ["jobNumber"], note: "To the office." }),
  part(id, label, "EMAIL", { subject: `${title} - {{jobNumber}}`, body: CLIENT_REQUEST_EMAIL.replace("{{requestTitle}}", title) }, { required: ["jobNumber"] }),
  part(id, label, "SMS", { body: `${title}: {{jobNumber}} at {{propertyName}}.` }, { required: ["jobNumber"] }),
];

export const JOB_CHANGED_WORDING = editable("job.changed", [
  ...notificationTemplateParts("job-updated", "Job updated", "jobUpdated"),
  part("job-updated", "Job updated", "EMAIL", { subject: "{{companyName}}: {{templateSubject}}", body: UPDATED_EMAIL }, { required: ["changeList"], note: "{{templateSubject}} is the in-app title of the shared template; {{changeList}} lists what changed." }),
  line("attention-suffix", "Immediate attention words", "EMAIL", " - immediate attention", "Added to the email heading when the date, times or status changed."),
  ...three("reset", "Job reset", "Job reset by admin", "{{jobNumber}} at {{propertyName}} has been reset by admin — {{clearedText}} were cleared. Please start the job again from your app.",
    "Job reset by admin", "<h2 style=\"margin:0 0 12px;\">Job reset</h2><p>{{jobNumber}} at {{propertyName}} has been reset by admin — {{clearedText}} were cleared. Please start the job again from your app.</p>",
    "{{jobNumber}} at {{propertyName}} has been reset by admin — {{clearedText}} were cleared. Please start the job again from your app.", ["jobNumber"], "The title is also the email subject. The SMS is cut at 320 characters."),
  line("cleared-clock", "Cleared: clock records", "INBOX", "your clock records", "Used in {{clearedText}}."),
  line("cleared-form", "Cleared: form and photos", "INBOX", "the submitted form and photos", "Used in {{clearedText}}."),
  line("cleared-joiner", "Joining word", "INBOX", " and ", "Joins the cleared items."),
  line("cleared-default", "Cleared: job progress", "INBOX", "the job progress", "Used in {{clearedText}} when nothing else was cleared."),
  ...three("rescheduled", "Rescheduled", "Job rescheduled", "The job is now scheduled for {{schedule}}. Open the job to review.",
    "Job rescheduled", "<p>The job is now scheduled for {{schedule}}. Open the job to review.</p>", "Job rescheduled: {{schedule}}. Open the job to review.", ["schedule"]),
  line("schedule-start", "Schedule: start time", "INBOX", " at {{startTime}}", "Added to {{schedule}} when there is a start time."),
  line("schedule-finish", "Schedule: finish time", "INBOX", ", finish by {{dueTime}}", "Added to {{schedule}} when there is a finish time."),
  ...three("tasks-added", "Extra tasks added", "{{companyName}}: extra {{taskWord}} added", "{{jobNumber}} at {{propertyName}}: {{taskListText}}",
    "{{companyName}}: extra {{taskWord}} on {{jobNumber}}", TASKS_EMAIL, "{{companyName}}: {{jobNumber}} extra task — {{taskListText}}", ["taskListText"], "{{taskWord}} is \"task\" or \"tasks\". The SMS is cut at 320 characters."),
  ...three("client-task", "Client task to approve", "Client task approval required", "Client task request for {{jobNumber}} at {{propertyName}} needs approval.",
    "Client task approval required - {{jobNumber}}", CLIENT_TASK_EMAIL, "Approval needed: client task for {{jobNumber}} at {{propertyName}}.", ["jobNumber"], "To the office."),
  ...CLIENT_ASKED("client-update", "Client asked for an update", "Client asked for an update"),
  ...CLIENT_ASKED("client-eta", "Client asked for an ETA", "Client asked for an ETA"),
  ...CLIENT_ASKED("client-report", "Client asked for the report", "Client asked for their report"),
  line("note-quote", "Client note (inbox)", "INBOX", " — “{{note}}”", "Added when the client wrote a note."),
  line("note-paragraph", "Note paragraph (email)", "EMAIL", "<p><strong>Note:</strong> {{note}}</p>", "Added when there is a note."),
  ...three("task-approved", "Task approved", "Job task approved", "{{taskTitle}} was approved for {{jobNumber}}.",
    "Job task approved - {{jobNumber}}", decisionEmail("A job task was approved."), "Approved: {{taskTitle}} for {{jobNumber}}.", ["taskTitle"]),
  ...three("task-declined", "Task declined", "Job task request declined", "{{taskTitle}} was declined for {{jobNumber}}.",
    "Job task request declined - {{jobNumber}}", decisionEmail("A job task request was declined."), "Declined: {{taskTitle}} for {{jobNumber}}.", ["taskTitle"]),
  ...three("task-auto-approved", "Task auto-approved", "Job task auto-approved", "{{taskTitle}} was auto-approved for {{jobNumber}}.",
    "Job task auto-approved - {{jobNumber}}", AUTO_APPROVED_EMAIL, "Auto-approved: {{taskTitle}} for {{jobNumber}}.", ["taskTitle"]),
  ...three("task-not-completed", "Task not completed", "Job task not completed", "{{taskTitle}} was marked not completed for {{jobNumber}}.",
    "Job task not completed - {{jobNumber}}", NOT_COMPLETED_EMAIL, "Not completed: {{taskTitle}} on {{jobNumber}}.", ["taskTitle"], "To the office."),
  line("reason-paragraph", "Reason paragraph (email)", "EMAIL", "<p><strong>Reason:</strong> {{note}}</p>", "Added when the cleaner gave a reason."),
], "The lines inside \"what changed\" (for example \"Job note: ...\", \"Turnaround flags: ...\") are built from each edited field and its new value; the sentence around them is editable.");
