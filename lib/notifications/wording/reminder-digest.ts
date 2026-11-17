import "server-only";
import type { ReminderDigestTexts } from "@/lib/email-design/reminder-digest";
import type { WordingRenderer } from "./render";

/**
 * The sentences of a combined reminder email (lines "digest-…" of the type's
 * wording), rendered for one cleaner. Subject and button are plain text;
 * heading, introduction, closing line and note are HTML with every value
 * escaped by the wording renderer.
 */
export function reminderDigestTexts(
  wording: WordingRenderer,
  input: { userName: string; jobCount: number; dayList: string; note?: string | null },
): ReminderDigestTexts {
  const values = { userName: input.userName, jobCount: input.jobCount, dayList: input.dayList };
  const note = input.note?.trim() ?? "";
  return {
    subject: wording.line("digest-subject", "INBOX", values),
    headingHtml: wording.line("digest-heading", "EMAIL", values),
    introHtml: wording.line("digest-intro", "EMAIL", values),
    outroHtml: wording.line("digest-outro", "EMAIL", values),
    buttonLabel: wording.line("digest-button", "INBOX", values),
    noteHtml: note ? wording.line("digest-note", "EMAIL", { note }) : "",
  };
}
