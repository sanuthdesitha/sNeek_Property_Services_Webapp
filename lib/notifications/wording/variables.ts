/**
 * The variable dictionary: a label, a sample value (for the preview and the
 * test send) and the HTML format of every variable a wording part may use.
 * Samples are invented, never real people or addresses. Plain module.
 */
import type { VariableFormat, WordingVariable } from "./types";

type Entry = { label: string; sample: string; format?: VariableFormat };

const DICTIONARY: Record<string, Entry> = {
  // People and places
  userName: { label: "Recipient name", sample: "Jane" },
  recipientName: { label: "Recipient name", sample: "Jane" },
  cleanerName: { label: "Cleaner name", sample: "Jane Cleaner" },
  clientName: { label: "Client name", sample: "Sam Host" },
  actorName: { label: "Sent by", sample: "Hannah" },
  requestedByName: { label: "Requested by", sample: "Hannah" },
  propertyName: { label: "Property", sample: "Manly Loft" },
  propertyAddress: { label: "Property address", sample: "12 Fairlight St, Manly" },
  place: { label: "Property (with suburb)", sample: "Manly Loft (Manly)" },
  companyName: { label: "Company name", sample: "sNeek Property Services" },
  // Jobs
  jobNumber: { label: "Job number", sample: "J-1061" },
  jobLabel: { label: "Job", sample: "J-1061 · Manly Loft" },
  jobType: { label: "Job type", sample: "Airbnb turnover" },
  jobUrl: { label: "Job link", sample: "sneek.au/j/1061" },
  jobsUrl: { label: "Jobs link", sample: "https://app.sneek.au/cleaner/jobs" },
  when: { label: "When", sample: "tomorrow 10:00" },
  day: { label: "Day", sample: "Thu 13 Nov" },
  startTime: { label: "Start time", sample: "10:00" },
  status: { label: "Job status", sample: "paused" },
  timingFlags: { label: "Timing notes", sample: "Guests arrive 14:00" },
  timingSuffix: { label: "Timing notes sentence (empty when none)", sample: " Guests arrive 14:00." },
  timingDash: { label: "Timing notes after a dash (empty when none)", sample: " — Guests arrive 14:00" },
  timingRow: { label: "Timing notes table row (empty when none)", sample: "<tr><td style=\"padding:2px 10px 2px 0;color:#666;\">Notes</td><td>Guests arrive 14:00</td></tr>", format: "html" },
  reason: { label: "Reason", sample: "Owner cancelled the booking" },
  note: { label: "Note", sample: "Spare key is in the lockbox" },
  noteSentence: { label: "Note sentence (empty when no note)", sample: " Note from admin: Spare key is in the lockbox" },
  noteParagraph: { label: "Note paragraph (empty when no note)", sample: "<p><em>Note from admin:</em> Spare key is in the lockbox</p>", format: "html" },
  notesParagraph: { label: "Notes paragraph (empty when none)", sample: "<p>Please upload a clear photo of both sides.</p>", format: "html" },
  time: { label: "Time", sample: "11:42" },
  // Laundry and stock
  laundryAsk: { label: "What is asked", sample: "Please confirm the laundry is bagged and ready" },
  requestTitle: { label: "Request", sample: "Please confirm the laundry pickup" },
  outcomeText: { label: "What happened", sample: "pickup rescheduled after failed attempt" },
  itemName: { label: "Item", sample: "Toilet paper" },
  quantity: { label: "Quantity", sample: "2" },
  unit: { label: "Unit", sample: "packs" },
  beforeJob: { label: "Before job (empty when no job)", sample: " before job J-1061" },
  officeNote: { label: "Office note sentence (empty when none)", sample: " Note from the office: \"Brand does not matter\"" },
  // Delays and documents
  etaSentence: { label: "New estimate sentence (empty when none)", sample: " The new estimate is about 30 minutes." },
  noteSuffix: { label: "Note (empty when none)", sample: " Running 30 minutes behind" },
  documentTitle: { label: "Document", sample: "Working with Children Check" },
  action: { label: "Approval asked for", sample: "skip" },
  etaMinutes: { label: "Minutes late", sample: "30" },
  messageText: { label: "The inbox wording, as sent", sample: "Your clean at Manly Loft is running late. The new estimate is about 30 minutes." },
  // Client job updates
  eta: { label: "Estimate", sample: "about 12 minutes away (arriving ~10:12 am)" },
  minutesWord: { label: "\"minute\" or \"minutes\"", sample: "minutes" },
  arrivalTime: { label: "Arrival time", sample: "10:12 am" },
  minutes: { label: "Minutes", sample: "15" },
  tripUrl: { label: "Live trip link", sample: "https://app.sneek.au/client/jobs/1061" },
  scheduleNote: { label: "Schedule note", sample: "Note: Your cleaner is running approximately 15 minutes behind the scheduled start time of 10:00." },
  etaDash: { label: "ETA (empty when none)", sample: " — ETA about 12 minutes away (arriving ~10:12 am)" },
  etaLine: { label: "ETA sentence (empty when none)", sample: " ETA: about 12 minutes away (arriving ~10:12 am)." },
  trackLine: { label: "Track live (empty when no link)", sample: " Track live: https://app.sneek.au/client/jobs/1061" },
  scheduleLine: { label: "Schedule note (empty when on time)", sample: " Note: Your cleaner is running approximately 15 minutes behind the scheduled start time of 10:00." },
  etaParagraph: { label: "ETA paragraph (empty when none)", sample: "<p><strong>ETA:</strong> about 12 minutes away (arriving ~10:12 am)</p>", format: "html" },
  scheduleParagraph: { label: "Schedule paragraph (empty when on time)", sample: "<p style=\"color:#b45309\">Note: Your cleaner is running approximately 15 minutes behind the scheduled start time of 10:00.</p>", format: "html" },
  trackLink: { label: "Track live link (empty when none)", sample: "<p><a href=\"https://app.sneek.au/client/jobs/1061\">Track live</a></p>", format: "html" },
  detailsLink: { label: "Job details link (empty when none)", sample: "<p><a href=\"https://app.sneek.au/client/jobs/1061\">View job details</a></p>", format: "html" },
  // Job changes
  changeList: { label: "What changed (list items)", sample: "<li>Start time: 10:00</li><li>Job note: Use the side gate</li>", format: "html" },
  taskList: { label: "Tasks (list items)", sample: "<li>Clean the oven</li>", format: "html" },
  reasonParagraph: { label: "Reason paragraph (empty when none)", sample: "<p><strong>Reason:</strong> Ran out of time</p>", format: "html" },
  taskTitle: { label: "Task", sample: "Clean the oven" },
  taskWord: { label: "\"task\" or \"tasks\"", sample: "task" },
  taskListText: { label: "Tasks", sample: "Clean the oven" },
  schedule: { label: "New schedule", sample: "2026-11-14 at 10:00, finish by 13:00" },
  clearedText: { label: "What was cleared", sample: "your clock records" },
  // Office alerts
  summaryHtml: { label: "Summary (built list)", sample: "<ul><li><strong>2</strong> jobs created</li></ul>", format: "html" },
  nearTermParagraph: { label: "Near-term warning (empty when none)", sample: "<p style=\"color:#b91c1c;font-weight:700;\">Changes affect jobs scheduled today, tomorrow, or within the next 48 hours.</p>", format: "html" },
  changedJobsHtml: { label: "Changed jobs (built list)", sample: "<div><h3>Changed jobs</h3><ul><li>J-1061 - Thu 13 Nov</li></ul></div>", format: "html" },
  warningsHtml: { label: "Warnings (built list)", sample: "", format: "html" },
  addonList: { label: "Add-ons (list items)", sample: "<li style=\"margin:2px 0;\">Oven clean</li>", format: "html" },
  clientNoteParagraph: { label: "Client note paragraph (empty when none)", sample: "<p style=\"margin:0 0 8px 0;\"><strong>Client note:</strong> Before 10 am please</p>", format: "html" },
  quoteHtml: { label: "Quote document (generated)", sample: "<p>Quote…</p>", format: "html" },
  // Maintenance
  detailRows: { label: "Detail rows (built table)", sample: "<tr><td>Property</td><td>Manly Loft</td></tr>", format: "html" },
  placeSuffix: { label: "Property (empty when none)", sample: " (Manly Loft)", format: "html" },
  nowPays: { label: "Now pays (empty when unknown)", sample: " — it now pays $180.00 fixed", format: "html" },
  stillPays: { label: "Still pays (empty when none)", sample: ", so it still pays $150.00 fixed", format: "html" },
  // Field alerts
  descriptionParagraph: { label: "Description paragraph (empty when none)", sample: "<p>Cracked tile near the shower</p>", format: "html" },
  severitySuffix: { label: "Severity (empty when none)", sample: " (HIGH)", format: "html" },
  // Cleaner requests
  requestedTimeParagraph: { label: "Requested time paragraph (empty when none)", sample: "<p><strong>Requested time:</strong> 11:00</p>", format: "html" },
  adminNoteParagraph: { label: "Admin note paragraph (empty when none)", sample: "<p><strong>Admin note:</strong> Guests leave late</p>", format: "html" },
  requestRows: { label: "Waiting requests (built rows)", sample: "<tr><td>Jane</td><td>Oven clean</td><td>$40.00</td><td>30h</td></tr>", format: "html" },
  // Client requests
  notesItem: { label: "Notes list item (empty when none)", sample: "<li><strong>Notes:</strong> Please bring a ladder</li>", format: "html" },
  // Post-job
  messageHtml: { label: "Rule message (line breaks kept)", sample: "Thanks for having us today.<br />We left the keys in the lockbox.", format: "html" },
  // Workforce
  lineItems: { label: "Lines (built list items)", sample: "<li>Jane — Visa expires in 3 days</li>", format: "html" },
  // Office messages
  subject: { label: "Subject the sender wrote", sample: "Roster for next week" },
  message: { label: "Message the sender wrote", sample: "The new roster is up in the team hub.", format: "multiline" },
};

export function variableDefinition(name: string): WordingVariable {
  const entry = DICTIONARY[name];
  if (entry) return { name, ...entry };
  // Email-template variables not listed above: a readable placeholder sample.
  const label = name.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/^./, (char) => char.toUpperCase());
  return { name, label, sample: `[${label}]` };
}

export function sampleValues(names: readonly string[]): Record<string, string> {
  return Object.fromEntries(names.map((name) => [name, variableDefinition(name).sample]));
}

export function variableFormats(names: readonly string[]): Record<string, VariableFormat | undefined> {
  return Object.fromEntries(names.map((name) => [name, variableDefinition(name).format]));
}
