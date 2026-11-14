/**
 * Stored shapes of email designs and the Email look (lib/email-design/store.ts).
 * Plain module (types only) so the editor can read them.
 */
import type { EmailDocument, EmailTheme } from "./types";

export type DesignActor = { id: string; name: string | null; role: string };

export type DesignVersion = {
  version: number;
  doc: EmailDocument;
  savedAt: string;
  actor: DesignActor;
  change: string;
  restoredFrom: number | null;
  idempotencyKey: string | null;
};

export type DesignDraft = {
  doc: EmailDocument;
  savedAt: string;
  actor: DesignActor;
  /** The version the draft started from (1 = the standard). */
  basedOn: number;
  idempotencyKey: string | null;
};

export type DesignRow = { revision: number; publishedVersion: number | null; draft: DesignDraft | null; versions: DesignVersion[] };

export type ThemeVersion = { version: number; theme: EmailTheme; savedAt: string; actor: DesignActor; idempotencyKey: string | null };
export type ThemeDraft = { theme: EmailTheme; savedAt: string; actor: DesignActor };
export type ThemeRow = { revision: number; publishedVersion: number | null; draft: ThemeDraft | null; versions: ThemeVersion[] };
