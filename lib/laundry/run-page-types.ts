/**
 * Data for the laundry run full page (`/v2/admin/laundry/runs/[id]`). PLAIN
 * module (types only): the server loader builds it, the client page reads it.
 * Every value is serialisable; times are already formatted in the
 * organisation's time zone, calendar days are left unshifted.
 */
import type { LaundryTeamRequestKind } from "./nudge-rules";

export type RunHistoryKind = "correction" | "void" | "handoff" | "team" | "office" | "system";

export type RunHistoryEntry = {
  id: string;
  /** ISO instant, for ordering. */
  at: string;
  /** Formatted in the organisation's time zone, e.g. "Thu 12 Nov 14:20". */
  when: string;
  who: string | null;
  label: string;
  detail: string | null;
  kind: RunHistoryKind;
};

export type RunFailedPickup = {
  id: string;
  when: string;
  who: string | null;
  reason: string | null;
  outcome: string;
  photoUrl: string | null;
};

export type RunCorrectionRow = {
  id: string;
  when: string;
  who: string | null;
  fromLabel: string;
  toLabel: string;
  doneBy: string | null;
  reason: string | null;
  backwards: boolean;
  /** The laundry team's own record that arrived after this correction, if any. */
  teamRecordWhen: string | null;
};

export type RunDoneByOption = { id: string; label: string };

export type RunInvoiceLine =
  | { state: "emailed"; label: string; detail: string }
  | { state: "draft"; label: string; detail: string }
  | { state: "none"; label: string; detail: string };

export type RunVoidInfo = { when: string; who: string | null; reason: string; previousStatus: string };

export type RunSkipRequest = { requestedAction: "SKIP" | "DELETE"; reason: string | null; when: string; who: string | null };

export type RunNextClean = { jobId: string; jobNumber: string | null; when: string };

export type RunViewer = {
  canChangeState: boolean;
  canVoid: boolean;
  /** Why Void and Undo void are not offered to this viewer (shown, never hidden silently). */
  voidBlockedReason: string | null;
  isAdmin: boolean;
  todayKey: string;
  /** The organisation's time zone: times typed in the dialogs are read in it. */
  timeZone: string;
};

export type RunPageExtras = {
  voided: RunVoidInfo | null;
  pendingSkipRequest: RunSkipRequest | null;
  failedPickups: RunFailedPickup[];
  corrections: RunCorrectionRow[];
  handoffWhen: string | null;
  handoffAtIso: string | null;
  emailedReport: string | null;
  invoiceLine: RunInvoiceLine;
  nextClean: RunNextClean | null;
  history: RunHistoryEntry[];
  doneByOptions: RunDoneByOption[];
  /** Exactly what the run page shows as "Voidable": Skipped, Flagged, or a failed pickup still waiting. */
  voidable: boolean;
  /** Team request kinds open on this run right now (for the primary action). */
  teamRequestKinds: LaundryTeamRequestKind[];
  pickupWhen: string | null;
  droppedWhen: string | null;
  createdWhen: string | null;
};
