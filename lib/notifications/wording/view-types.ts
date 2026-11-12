/** Shapes the wording API returns to the notifications screen. Plain, client-safe. */
import type { WordingField, WordingFields, WordingStatus, WordingTransport, WordingVariable } from "./types";

export type WordingVersionView = {
  version: number;
  savedAt: string | null;
  actorName: string | null;
  kind: "DEFAULT" | "EDIT" | "RESTORE" | "RESET";
  change: string;
  fields: WordingFields;
};

export type WordingPartView = {
  id: string;
  label: string;
  transport: WordingTransport;
  fields: WordingField[];
  variables: WordingVariable[];
  required: string[];
  note: string | null;
  push: "SHARED" | null;
  source: "STORE" | "EMAIL_TEMPLATE";
  templateKey: string | null;
  defaults: WordingFields;
  live: WordingFields;
  /** Sent back on save: the stale-write guard. */
  liveHash: string;
  /** null when the live text was changed outside this screen (in Forms). */
  liveVersion: number | null;
  /** default; override (a saved version); forms (edited in Forms); invalid (a broken override: the default is sent). */
  liveSource: "default" | "override" | "forms" | "invalid";
  problems: string[];
  versions: WordingVersionView[];
};

export type RegenerateAvailability = { available: boolean; reason: string | null };

export type TypeWordingResponse = {
  typeKey: string;
  status: WordingStatus;
  reason: string | null;
  href: string | null;
  parts: WordingPartView[];
  canEdit: boolean;
  editReason: string | null;
  regenerate: RegenerateAvailability;
};

export type WordingSummary = {
  typeKey: string;
  status: WordingStatus;
  transports: WordingTransport[];
  edited: boolean;
  problems: number;
  liveVersion: number;
};
