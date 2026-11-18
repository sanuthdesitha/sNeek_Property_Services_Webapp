/**
 * Client-handled maintenance: the shapes the admin card and the client
 * section read (dates as ISO strings). Plain types module, safe for client
 * components.
 */
import type { VisitAccessMethod } from "@/lib/maintenance/visit-plan";

export type ClientHandlingState = "NONE" | "HANDED_OVER" | "ACCEPTED" | "DECLINED" | "DONE" | "NOT_DONE" | "TAKEN_BACK";

/** The transports the office may choose for the hand-over message and a reminder. */
export type ClientMessageTransport = "INBOX" | "EMAIL";

/** One transport's real outcome for one recipient. Queued is not delivered. */
export type ClientMessageOutcome = {
  name: string;
  transport: string;
  state: string;
  errorCode: string | null;
  /** "sent" = a transport took it; "held" = not sent on purpose; "failed" = it went wrong. */
  tone: "sent" | "held" | "failed";
  /** One plain sentence, e.g. "Sent (accepted by the email provider)". */
  label: string;
};

/** What happened to one hand-over message or reminder. */
export type ClientMessageRecord = {
  at: string;
  transports: ClientMessageTransport[];
  /** Why nothing could be sent at all (no login, notifications off), or null. */
  refusal: string | null;
  outcomes: ClientMessageOutcome[];
  /** At least one transport took it (not proof it was read). */
  taken: boolean;
  /** Still being sent when this was read. */
  pending?: boolean;
};

export type TradespersonView = {
  name: string;
  phone: string | null;
  trade: string | null;
  company: string | null;
  note: string | null;
  plannedStart: string | null;
  plannedEnd: string | null;
  accessMethod: VisitAccessMethod | null;
  /** True when the visit is on the cleaner's job surface for that day. */
  onCleanersDay: boolean;
};

export type ActorStamp = { at: string; byName: string } | null;

export type ClientHandlingPhoto = { key: string; url: string };

/** Everything the office sees about the client handling of one item. */
export type AdminClientHandlingView = {
  itemId: string;
  version: number;
  state: ClientHandlingState;
  withClient: boolean;
  status: string;
  clientVisible: boolean;
  clientName: string | null;
  handedOver: (ActorStamp & { note: string | null }) | null;
  handoverMessage: ClientMessageRecord | null;
  response: { state: "ACCEPTED" | "DECLINED"; at: string; byName: string; reason: string | null } | null;
  tradesperson: (TradespersonView & { updatedAt: string | null; updatedByName: string | null }) | null;
  outcome: { state: "DONE" | "NOT_DONE"; at: string; byName: string; note: string | null; photos: ClientHandlingPhoto[] } | null;
  reminders: { count: number; last: (ActorStamp & { message: ClientMessageRecord | null }) | null; nextAllowedAt: string | null };
  takenBack: (ActorStamp & { reason: string | null }) | null;
  /** Why the item cannot be handed over now (empty when it can). */
  handoverBlockers: string[];
  /** Why a reminder cannot be sent now, or null when it can. */
  reminderBlocker: string | null;
  /** Active client logins a message would go to. */
  recipients: number;
};

/** What a client-side person sees about one item handed to them. No costs, codes or internal notes. */
export type ClientHandledItemView = {
  id: string;
  version: number;
  title: string;
  description: string | null;
  area: string | null;
  category: string;
  priority: string;
  property: { id: string; name: string; suburb: string | null };
  photos: ClientHandlingPhoto[];
  officeNote: string | null;
  handedOverAt: string | null;
  state: ClientHandlingState;
  /** The office has closed the item (resolved or dismissed). */
  closed: boolean;
  /** This person may act now (accept, decline, tradesperson, done). */
  canAct: boolean;
  response: { state: "ACCEPTED" | "DECLINED"; at: string; byName: string; reason: string | null } | null;
  tradesperson: (TradespersonView & { updatedAt: string | null; updatedByName: string | null }) | null;
  outcome: { state: "DONE" | "NOT_DONE"; at: string; byName: string; note: string | null; photos: ClientHandlingPhoto[] } | null;
  takenBackAt: string | null;
};

export type ClientHandlingAction = "ACCEPT" | "DECLINE" | "SET_TRADESPERSON" | "CLEAR_TRADESPERSON" | "MARK_DONE" | "COULD_NOT_DO";
