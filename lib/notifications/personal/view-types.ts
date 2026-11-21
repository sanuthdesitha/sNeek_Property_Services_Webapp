/**
 * What the personal notification screens receive (the person's own screen
 * and an administrator's view of that person are the same shape). Client-safe.
 */
import type { FixedReason, PersonalTransport } from "./model";

export type SwitchStamp = { byName: string | null; byRole: string | null; at: string };

export type SwitchCell = {
  /** The switch id to send back when changing it. */
  id: string;
  transport: PersonalTransport | null;
  label: string;
  /** The person's own choice for this switch. */
  on: boolean;
  /** False when the person cannot change it here (always sent, office decision). */
  editable: boolean;
  /** Set when an office-level switch stops this whatever the person chooses. */
  officeOff: string | null;
  /** Set when this cannot reach the person at all (no email address, no mobile number). */
  unavailable: string | null;
  /** Set when a broader personal switch (all, all email, …) already stops it. */
  coveredBy: string | null;
  /** Who last changed this switch and when, if recorded. */
  changed: SwitchStamp | null;
};

export type TypeRowView = {
  key: string;
  name: string;
  trigger: string;
  fixed: FixedReason | null;
  fixedText: string | null;
  /** "When someone in the office sends this by hand, it still goes." for office-sent types. */
  officeNote: string | null;
  cells: SwitchCell[];
};

export type GroupView = { label: string; rows: TypeRowView[] };

export type TopicView = { category: string; label: string; description: string; cells: SwitchCell[] };

export type SubjectKind = "USER" | "CLIENT";

export type PersonalSwitchesView = {
  subject: {
    kind: SubjectKind;
    id: string;
    name: string | null;
    /** Portal role of a login; "CLIENT" for a client account. */
    role: string;
    hasEmail: boolean;
    hasPhone: boolean;
  };
  revision: number;
  timeZone: string;
  master: SwitchCell;
  transports: SwitchCell[];
  /** Client account only: the three long-standing job-update events. */
  jobEvents: SwitchCell[] | null;
  groups: GroupView[];
  /** Logins only: the older per-topic switches, still applied. */
  topics: TopicView[] | null;
  /** A client login: its account's switches also apply (summary). */
  account: { clientId: string; name: string | null; allOff: boolean; offCount: number } | null;
  /** A client account: its logins, each with their own switches. */
  logins: Array<{ id: string; name: string | null; email: string | null; offCount: number }> | null;
  /** How many switches are off in this view (personal choices only). */
  offCount: number;
  canEdit: boolean;
  readOnlyReason: string | null;
};

export type SwitchChangeRequest = { id: string; on: boolean };

export type SwitchesSaveRequest = { revision: number; changes: SwitchChangeRequest[] };

/** One person or client account with something switched off (administrator's list). */
export type OffListEntry = {
  kind: SubjectKind;
  id: string;
  name: string | null;
  role: string;
  offCount: number;
  summary: string;
  lastChange: SwitchStamp | null;
  href: string;
};
