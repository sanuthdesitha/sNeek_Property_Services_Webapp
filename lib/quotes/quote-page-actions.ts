/**
 * The quote full page's header and rail rules (board "Quote full page: detail
 * and edit combined", 2026-11). Plain module: the server page and the client
 * page read the same answers, and the tables are tested on their own.
 *
 * Every action here only STARTS something that already exists: the send route
 * (preview, then send), the quote PATCH (status), the convert-to-job route, a
 * link. No action adds a business rule; the routes keep their own checks.
 */
import type { EStage } from "@/components/v2/ui/stage-bar";

export type QuotePageStatus = "DRAFT" | "SENT" | "ACCEPTED" | "DECLINED" | "CONVERTED";

export const QUOTE_PAGE_STATUSES: readonly QuotePageStatus[] = ["DRAFT", "SENT", "ACCEPTED", "DECLINED", "CONVERTED"];

export const QUOTE_STATUS_LABEL: Record<QuotePageStatus, string> = {
  DRAFT: "Draft",
  SENT: "Sent",
  ACCEPTED: "Accepted",
  DECLINED: "Declined",
  CONVERTED: "Converted",
};

export type QuotePrimaryKind = "review-send" | "mark-won" | "convert" | "open-job" | "open-client" | "reopen" | "none";

/** Status → primary action, as written on the board's idea box. */
export const QUOTE_PRIMARY_BY_STATUS: Record<QuotePageStatus, QuotePrimaryKind> = {
  DRAFT: "review-send",
  SENT: "mark-won",
  ACCEPTED: "convert",
  CONVERTED: "open-job",
  DECLINED: "reopen",
};

export type QuotePrimaryAction = {
  kind: QuotePrimaryKind;
  label: string;
  /** Set when the action is a link. */
  href: string | null;
  /** The status the action PATCHes (mark won, reopen); null otherwise. */
  patchStatus: QuotePageStatus | null;
};

export type QuoteActionFacts = {
  status: string;
  convertedJobId: string | null;
  clientId: string | null;
};

export function asQuoteStatus(value: string): QuotePageStatus {
  return (QUOTE_PAGE_STATUSES as readonly string[]).includes(value) ? (value as QuotePageStatus) : "DRAFT";
}

export function quotePrimaryAction(facts: QuoteActionFacts): QuotePrimaryAction {
  const status = asQuoteStatus(facts.status);
  const kind = QUOTE_PRIMARY_BY_STATUS[status];
  switch (kind) {
    case "review-send":
      return { kind, label: "Review and send", href: null, patchStatus: null };
    case "mark-won":
      return { kind, label: "Mark won", href: null, patchStatus: "ACCEPTED" };
    case "convert":
      return { kind, label: "Convert to job", href: "#convert", patchStatus: null };
    case "reopen":
      return { kind, label: "Reopen as draft", href: null, patchStatus: "DRAFT" };
    default:
      break;
  }
  // Converted: the job when one was created; a quote "marked won" without a
  // job (convert with "Create a job now" off) has no job to open.
  if (facts.convertedJobId) {
    return { kind: "open-job", label: "Open job", href: `/v2/admin/jobs/${facts.convertedJobId}`, patchStatus: null };
  }
  if (facts.clientId) {
    return { kind: "open-client", label: "Open client", href: `/v2/admin/clients/${facts.clientId}`, patchStatus: null };
  }
  return { kind: "none", label: "", href: null, patchStatus: null };
}

/** Header secondary buttons: Preview PDF and Copy public link always; Resend once the quote has left draft. */
export function quoteSecondaryActions(statusValue: string): { previewPdf: true; copyLink: true; resend: boolean } {
  const status = asQuoteStatus(statusValue);
  return { previewPdf: true, copyLink: true, resend: status === "SENT" || status === "ACCEPTED" || status === "DECLINED" };
}

/**
 * Convert to job: offered once the quote is won (accepted). The convert route
 * itself still refuses declined and converted quotes.
 */
export function convertAvailability(statusValue: string): { enabled: boolean; reason: string | null } {
  const status = asQuoteStatus(statusValue);
  if (status === "ACCEPTED") return { enabled: true, reason: null };
  if (status === "DECLINED") return { enabled: false, reason: "A declined quote can't be converted to a job." };
  if (status === "CONVERTED") return { enabled: false, reason: "This quote is already converted." };
  return { enabled: false, reason: "Available once won or accepted. Mark it won first." };
}

/** Today's edit rule (quote PATCH): only a converted quote's service and pricing are locked. */
export function quoteEditLock(statusValue: string): string | null {
  return asQuoteStatus(statusValue) === "CONVERTED"
    ? "This quote was converted to a job, so its service, pricing and presentation can no longer be edited. The job now owns the scope and price."
    : null;
}

export type QuoteStageFacts = {
  status: string;
  /** A public link exists: minted by the first send or share. */
  shared: boolean;
  acceptedAt: string | null;
  convertedJobId: string | null;
};

/**
 * Stage strip from stored facts only: a stage is "done" only with a recorded
 * fact; one the quote went past without a record is "passed".
 */
export function quoteStages(facts: QuoteStageFacts): EStage[] {
  const status = asQuoteStatus(facts.status);
  const sentState = facts.shared ? "done" : "passed";
  const acceptedState = facts.acceptedAt ? "done" : "passed";
  const stages: EStage[] = [
    { key: "draft", label: "Draft", state: status === "DRAFT" ? "current" : "done" },
    { key: "sent", label: "Sent to client", state: "todo" },
    { key: "accepted", label: "Accepted", state: "todo" },
    { key: "converted", label: "Converted to job", state: "todo" },
    { key: "declined", label: "or Declined", state: "todo", unnumbered: true },
  ];
  const set = (key: string, state: EStage["state"], note?: string) => {
    const stage = stages.find((entry) => entry.key === key)!;
    stage.state = state;
    if (note) stage.note = note;
  };
  if (status === "SENT") set("sent", "current");
  if (status === "ACCEPTED") {
    set("sent", sentState);
    set("accepted", "current");
  }
  if (status === "CONVERTED") {
    set("sent", sentState);
    set("accepted", acceptedState);
    set("converted", "current", facts.convertedJobId ? "Job created" : "No job yet");
  }
  if (status === "DECLINED") {
    set("sent", sentState);
    set("accepted", "skipped");
    set("converted", "skipped");
    set("declined", "current");
  }
  return stages;
}

/** Where "Create repair quote" in the More menu goes. */
export function repairQuoteHref(input: { fromCaseId: string | null; clientId: string | null }): { label: string; href: string } {
  if (input.fromCaseId) return { label: "Create repair quote", href: `/v2/admin/quotes/new?fromCase=${encodeURIComponent(input.fromCaseId)}` };
  if (input.clientId) return { label: "New quote for this client", href: `/v2/admin/quotes/new?clientId=${encodeURIComponent(input.clientId)}` };
  return { label: "New quote", href: "/v2/admin/quotes/new" };
}
