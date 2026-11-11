/**
 * Typed line drafts for the invoice editor: what the admin has typed but not
 * saved, kept apart from the server's lines so a reload never overwrites it.
 * Pure helpers, tested directly.
 */
import type { EditorLine } from "@/lib/billing/client-invoice-editor-types";

/** Text as typed, so a half-typed "1." is never lost to number parsing. */
export type LineDraft = { description: string; quantity: string; unitPrice: string };
export type LineDrafts = Record<string, LineDraft>;

export const EMPTY_NEW_LINE: LineDraft = { description: "", quantity: "1", unitPrice: "" };

export function draftFromLine(line: EditorLine): LineDraft {
  return { description: line.description, quantity: String(line.quantity), unitPrice: line.unitPrice.toFixed(2) };
}

/** True when the draft would change the stored line. */
export function draftDiffers(line: EditorLine, draft: LineDraft | undefined): boolean {
  if (!draft) return false;
  if (draft.description.trim() !== line.description) return true;
  if (line.shoppingLocked) return false;
  return Number(draft.quantity) !== line.quantity || Number(draft.unitPrice) !== line.unitPrice;
}

export function dirtyLineIds(lines: EditorLine[], drafts: LineDrafts): string[] {
  return lines.filter((line) => draftDiffers(line, drafts[line.id])).map((line) => line.id);
}

export type LineUpdate = { id: string; description?: string; quantity?: number; unitPrice?: number };
export type DraftValidation = { updates: LineUpdate[]; invalid: Record<string, string> };

/**
 * The PATCH `updateLines` for every changed line, using the API's own limits
 * (description required, quantity above zero, price zero or more). A reviewed
 * shopping line sends its description only: its amount is locked.
 */
export function buildLineUpdates(lines: EditorLine[], drafts: LineDrafts): DraftValidation {
  const updates: LineUpdate[] = [];
  const invalid: Record<string, string> = {};
  for (const line of lines) {
    const draft = drafts[line.id];
    if (!draft || !draftDiffers(line, draft)) continue;
    const description = draft.description.trim();
    if (!description) {
      invalid[line.id] = "Add a description.";
      continue;
    }
    if (line.shoppingLocked) {
      updates.push({ id: line.id, description });
      continue;
    }
    const quantity = Number(draft.quantity);
    const unitPrice = Number(draft.unitPrice);
    if (!draft.quantity.trim() || !Number.isFinite(quantity) || quantity <= 0) {
      invalid[line.id] = "Quantity must be more than zero.";
      continue;
    }
    if (!draft.unitPrice.trim() || !Number.isFinite(unitPrice) || unitPrice < 0) {
      invalid[line.id] = "Rate must be zero or more.";
      continue;
    }
    updates.push({ id: line.id, description, quantity, unitPrice });
  }
  return { updates, invalid };
}

export type NewLineValidation = { ok: true; line: { description: string; quantity: number; unitPrice: number } } | { ok: false; message: string };

export function validateNewLine(draft: LineDraft): NewLineValidation {
  const description = draft.description.trim();
  const quantity = Number(draft.quantity);
  const unitPrice = Number(draft.unitPrice);
  if (!description) return { ok: false, message: "Add a description for the new line." };
  if (!draft.quantity.trim() || !Number.isFinite(quantity) || quantity <= 0) return { ok: false, message: "Quantity must be more than zero." };
  if (!draft.unitPrice.trim() || !Number.isFinite(unitPrice) || unitPrice < 0) return { ok: false, message: "Enter a rate of zero or more." };
  return { ok: true, line: { description, quantity, unitPrice } };
}

export function newLineStarted(draft: LineDraft): boolean {
  return Boolean(draft.description.trim() || draft.unitPrice.trim()) || draft.quantity.trim() !== EMPTY_NEW_LINE.quantity;
}

/** Drop drafts for lines that no longer exist, and drafts that now match the server. */
export function pruneDrafts(lines: EditorLine[], drafts: LineDrafts): LineDrafts {
  const next: LineDrafts = {};
  for (const line of lines) {
    const draft = drafts[line.id];
    if (draft && draftDiffers(line, draft)) next[line.id] = draft;
  }
  return next;
}
