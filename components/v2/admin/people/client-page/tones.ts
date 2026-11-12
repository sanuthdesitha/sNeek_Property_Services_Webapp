/**
 * Badge tones and small formatters for the client page (moved from the page
 * when it was redrawn). Plain module, usable by server components.
 */
import { CaseState, ClientInvoiceStatus, JobStatus, LeadStatus, QuoteStatus } from "@prisma/client";

export type Tone = "neutral" | "primary" | "gold" | "success" | "warning" | "danger" | "info" | "aubergine";

export function jobStatusTone(status: JobStatus): Tone {
  switch (status) {
    case JobStatus.UNASSIGNED:
    case JobStatus.OFFERED:
      return "warning";
    case JobStatus.ASSIGNED:
    case JobStatus.EN_ROUTE:
      return "primary";
    case JobStatus.IN_PROGRESS:
    case JobStatus.PAUSED:
    case JobStatus.WAITING_CONTINUATION_APPROVAL:
      return "info";
    case JobStatus.QA_REVIEW:
      return "aubergine";
    case JobStatus.COMPLETED:
    case JobStatus.INVOICED:
      return "success";
    default:
      return "neutral";
  }
}

export function invoiceStatusTone(status: ClientInvoiceStatus): Tone {
  switch (status) {
    case ClientInvoiceStatus.APPROVED:
      return "info";
    case ClientInvoiceStatus.SENT:
      return "warning";
    case ClientInvoiceStatus.PAID:
      return "success";
    default:
      return "neutral";
  }
}

export function quoteStatusTone(status: QuoteStatus): Tone {
  switch (status) {
    case QuoteStatus.SENT:
      return "warning";
    case QuoteStatus.ACCEPTED:
      return "success";
    case QuoteStatus.DECLINED:
      return "danger";
    case QuoteStatus.CONVERTED:
      return "info";
    default:
      return "neutral"; // DRAFT
  }
}

export function caseStateTone(state: CaseState): Tone {
  switch (state) {
    case CaseState.OPEN:
    case CaseState.TRIAGE:
      return "warning";
    case CaseState.ASSIGNED:
    case CaseState.IN_PROGRESS:
      return "info";
    case CaseState.AWAITING_CLIENT:
      return "aubergine";
    case CaseState.RESOLVED:
    case CaseState.CLOSED:
      return "success";
    default:
      return "neutral"; // CANCELLED
  }
}

export function leadStatusTone(status: LeadStatus): Tone {
  switch (status) {
    case LeadStatus.NEW:
      return "warning";
    case LeadStatus.CONTACTED:
      return "info";
    case LeadStatus.QUOTED:
      return "primary";
    case LeadStatus.CONVERTED:
      return "success";
    default:
      return "neutral"; // LOST
  }
}

/** Lead estimates are optional on both ends — mirror v1's "$a – $b" / single-figure / em-dash fallbacks. */
export function formatEstimate(min: number | null, max: number | null): string {
  if (min != null && max != null) return `${money(min)} – ${money(max)}`;
  if (min != null) return `from ${money(min)}`;
  if (max != null) return `up to ${money(max)}`;
  return "—";
}

export function titleCase(value: string): string {
  return value
    .toLowerCase()
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

export function money(n: number): string {
  return "$" + Math.round(n).toLocaleString("en-AU");
}

