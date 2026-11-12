/**
 * Quote page autosave rules (owner decision 2026-11-13). Plain module, shared
 * by the quote page's autosave hook and its tests; mirrors the invoice
 * editor's Wave D design.
 *
 * Autosave runs only on a saved quote whose status is Draft (never on
 * `/quotes/new`; never on Sent, Accepted, Declined or Converted quotes, which
 * keep the explicit Save so a half-finished edit never reaches the client's
 * online page or changes an accepted price), only while every field is valid, one save at a time,
 * and it never sends or changes the status: it writes the builder's edit body
 * through the quote PATCH with `expectedUpdatedAt`, then the staged discount
 * through the discount route, exactly as the explicit Save did.
 */
import type { QuoteLineItem } from "./quote-record";

/** Pause after the last change before the draft is saved. */
export const QUOTE_AUTOSAVE_DELAY_MS = 1500;
/** The `what` of a background save (anything else froze the page). */
export const QUOTE_AUTOSAVE = "Autosave";

export type QuoteSaveStatus =
  | { kind: "idle" }
  | { kind: "saving"; what: string }
  | { kind: "saved"; what: string }
  | { kind: "failed"; what: string; message: string; retry: (() => void) | null }
  | { kind: "conflict"; what: string; message: string };

export type QuoteDraftCheckInput = {
  lines: QuoteLineItem[];
  subtotal: number;
  validUntilDate: string;
  recipientMode: "client" | "lead" | "new";
  clientId: string;
  /** The stored quote has a client: choosing "no client" would unassign it. */
  storedHasClient: boolean;
};

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Why the current draft must not be saved yet (shown on Save; autosave just
 * waits), or null when it is valid.
 */
export function quoteDraftProblem(input: QuoteDraftCheckInput): string | null {
  if (input.lines.length === 0 || !(input.subtotal > 0)) return "Calculate from the rate card, add line items, or pick extras.";
  const badLine = input.lines.findIndex((line) => !line.label.trim() || ![line.unitPrice, line.qty, line.total].every((value) => Number.isFinite(value)));
  if (badLine >= 0) return `Line ${badLine + 1} needs a description and a price.`;
  if (input.validUntilDate && (!DAY.test(input.validUntilDate) || Number.isNaN(new Date(`${input.validUntilDate}T00:00:00`).getTime()))) {
    return "Enter a valid date in Valid until, or clear it.";
  }
  if (input.recipientMode === "client" && !input.clientId && input.storedHasClient) return "Choose the client this quote is for.";
  return null;
}

/** Autosave applies only to a Draft: the client cannot open it yet. */
export function autosaveAppliesTo(quoteStatus: string): boolean {
  return quoteStatus === "DRAFT";
}

export type QuoteAutosaveGate = {
  isNew: boolean;
  /** The stored quote's status (DRAFT, SENT, ACCEPTED, DECLINED, CONVERTED). */
  quoteStatus: string;
  locked: boolean;
  dirty: boolean;
  problem: string | null;
  /** A rate-card calculation, the checklist load or another quote write is in progress. */
  busy: boolean;
  status: QuoteSaveStatus;
  /** The draft that last failed to save (not repeated until it changes or Retry is pressed). */
  failedKey: string | null;
  key: string;
};

/** Whether a debounced autosave may be scheduled for this draft. */
export function mayAutosave(gate: QuoteAutosaveGate): boolean {
  if (gate.isNew || gate.locked || !autosaveAppliesTo(gate.quoteStatus) || !gate.dirty || gate.problem || gate.busy) return false;
  if (gate.status.kind === "saving" || gate.status.kind === "conflict") return false;
  return gate.failedKey !== gate.key;
}

/** "just now", "10 seconds ago", "3 minutes ago". */
export function savedAgoText(savedAt: number, now: number): string {
  const seconds = Math.max(0, Math.round((now - savedAt) / 1000));
  if (seconds < 5) return "just now";
  if (seconds < 60) return `${seconds} seconds ago`;
  const minutes = Math.round(seconds / 60);
  return minutes === 1 ? "1 minute ago" : `${minutes} minutes ago`;
}

export type QuoteSaveStateInput = {
  isNew: boolean;
  creating: boolean;
  status: QuoteSaveStatus;
  unsaved: boolean;
  lastSavedAt: number | null;
  now: number;
};

/** The words in the header line and the Status card. */
export function quoteSaveStateLabel(input: QuoteSaveStateInput): string {
  if (input.isNew) return input.creating ? "Saving…" : "Not saved yet";
  if (input.status.kind === "saving") return "Saving…";
  if (input.status.kind === "conflict") return "Not saved: changed elsewhere";
  if (input.status.kind === "failed") return "Not saved";
  if (input.unsaved) return "Unsaved changes";
  if (input.lastSavedAt !== null) return `Saved ${savedAgoText(input.lastSavedAt, input.now)}`;
  return "All changes saved";
}

/**
 * A quote the client can already open: its public page reads the stored quote
 * live, so each change is visible there as soon as Save is pressed (no email
 * is sent).
 */
export function quoteIsLiveForClient(status: string, publicToken: string | null): boolean {
  return Boolean(publicToken) && status !== "DRAFT" && status !== "CONVERTED";
}
