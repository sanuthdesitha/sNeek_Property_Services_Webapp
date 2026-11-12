import "server-only";
import type { BulkAssignedEmailTexts } from "@/lib/email-templates";
import type { WordingRenderer } from "./render";

/**
 * The sentences of the combined assignment email (catalog type job.offer),
 * rendered for one cleaner. Subject and button are plain text; heading, intro
 * and closing line are HTML with every value escaped.
 */
export function bulkEmailTexts(wording: WordingRenderer, input: { companyName: string; userName: string; jobCount: number }): BulkAssignedEmailTexts {
  const one = input.jobCount === 1;
  const values = {
    companyName: input.companyName,
    userName: input.userName,
    jobCount: input.jobCount,
    jobWord: one ? "job" : "jobs",
    hasWord: one ? "has" : "have",
    itWord: one ? "it" : "each one",
    offerWord: one ? "this offer" : "each offer",
  };
  return {
    subject: wording.line("bulk-subject", "INBOX", values),
    headingHtml: wording.line("bulk-heading", "EMAIL", values),
    introHtml: wording.line("bulk-intro", "EMAIL", values),
    outroHtml: wording.line("bulk-outro", "EMAIL", values),
    buttonLabel: wording.line(one ? "bulk-button-one" : "bulk-button-many", "INBOX", values),
  };
}
