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
