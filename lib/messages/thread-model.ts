/**
 * Client conversations on the Messages page (board "Messages", 2026-11).
 * Plain module: list filters and real counts over the threads the list route
 * returned, who wrote each message, the honest state of an office message,
 * and the phone view (stacked list / thread / compose with back navigation).
 */
import { formatInTimeZone } from "date-fns-tz";

export type ThreadSummary = {
  id: string;
  name: string;
  email: string | null;
  updatedAt: string;
  messages: Array<{ id: string; body: string; createdAt: string; isFromAdmin: boolean; isRead: boolean }>;
  _count: { messages: number };
};

export type ThreadMessage = {
  id: string;
  body: string;
  isFromAdmin: boolean;
  isRead?: boolean;
  createdAt: string;
  jobId?: string | null;
  sentBy?: { id: string; name: string | null; email: string | null; role: string } | null;
};

export type ThreadFilter = "all" | "unread" | "waiting";

export const THREAD_FILTER_LABEL: Record<ThreadFilter, string> = { all: "All", unread: "Unread", waiting: "Waiting on us" };

/** The list route reads at most this many clients (most recently updated first). */
export const THREAD_LIST_CAP = 200;

export const hasConversation = (thread: ThreadSummary) => thread.messages.length > 0;
export const isUnread = (thread: ThreadSummary) => thread._count.messages > 0;
/** The client wrote last, so the next move is ours. */
export const isWaitingOnUs = (thread: ThreadSummary) => Boolean(thread.messages[0] && !thread.messages[0].isFromAdmin);

export type ThreadCounts = Record<ThreadFilter, number> & { capped: boolean };

export function threadCounts(threads: ThreadSummary[]): ThreadCounts {
  const conversations = threads.filter(hasConversation);
  return {
    all: conversations.length,
    unread: conversations.filter(isUnread).length,
    waiting: conversations.filter(isWaitingOnUs).length,
    capped: threads.length >= THREAD_LIST_CAP,
  };
}

/**
 * Chips filter conversations. A search also finds clients with no messages
 * yet, so the office can start a conversation with any active client.
 */
export function filterThreads(threads: ThreadSummary[], filter: ThreadFilter, search: string): ThreadSummary[] {
  const q = search.trim().toLowerCase();
  const pool = q
    ? threads.filter((t) => t.name.toLowerCase().includes(q) || (t.email ?? "").toLowerCase().includes(q) || (t.messages[0]?.body ?? "").toLowerCase().includes(q))
    : threads.filter(hasConversation);
  if (filter === "unread") return pool.filter(isUnread);
  if (filter === "waiting") return pool.filter(isWaitingOnUs);
  return pool;
}

const ROLE_WORD: Record<string, string> = { VA: "assistant", CLIENT: "client", ADMIN: "office", OPS_MANAGER: "office" };

/** "Grace Kim, assistant" for a client's assistant; the person's name otherwise. */
export function authorLabel(message: ThreadMessage, clientName: string): string {
  const name = message.sentBy?.name?.trim() || message.sentBy?.email || null;
  if (message.isFromAdmin) return name ?? "Office";
  if (!name) return clientName;
  return message.sentBy?.role === "VA" ? `${name}, ${ROLE_WORD.VA}` : name;
}

/** An office message's state in words; "Read" only when the client opened it. */
export function officeMessageState(message: ThreadMessage): string {
  return message.isRead ? "Read" : "Saved · not read yet";
}

export function formatThreadTime(iso: string, timezone: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? "" : formatInTimeZone(date, timezone, "HH:mm");
}

export function threadDayKey(iso: string, timezone: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? "" : formatInTimeZone(date, timezone, "yyyy-MM-dd");
}

/** "Today", "Yesterday" or "Tue 10 Nov", by the organisation's calendar day. */
export function threadDayLabel(iso: string, timezone: string, now: Date = new Date()): string {
  const key = threadDayKey(iso, timezone);
  const today = formatInTimeZone(now, timezone, "yyyy-MM-dd");
  const yesterday = formatInTimeZone(new Date(now.getTime() - 86_400_000), timezone, "yyyy-MM-dd");
  if (key === today) return "Today";
  if (key === yesterday) return "Yesterday";
  return formatInTimeZone(new Date(iso), timezone, "EEE d MMM");
}

/** List time: clock today, "Yesterday", else "10 Nov". */
export function listTime(iso: string, timezone: string, now: Date = new Date()): string {
  const label = threadDayLabel(iso, timezone, now);
  if (label === "Today") return formatThreadTime(iso, timezone);
  if (label === "Yesterday") return label;
  return formatInTimeZone(new Date(iso), timezone, "d MMM");
}

/* ── Phone view: the three columns become stacked views ─────────────────── */

export type MessagesView = "list" | "thread" | "compose";
export type ViewState = { view: MessagesView; history: MessagesView[] };
export type ViewEvent = { type: "open-thread" } | { type: "open-compose" } | { type: "back" } | { type: "close-compose" };

export function initialView(opts: { compose: boolean; threadOpen: boolean }): ViewState {
  if (opts.compose) return { view: "compose", history: ["list"] };
  if (opts.threadOpen) return { view: "thread", history: ["list"] };
  return { view: "list", history: [] };
}

export function nextView(state: ViewState, event: ViewEvent): ViewState {
  switch (event.type) {
    case "open-thread":
      return state.view === "thread" ? state : { view: "thread", history: [...state.history.filter((v) => v !== "thread"), state.view] };
    case "open-compose":
      return state.view === "compose" ? state : { view: "compose", history: [...state.history, state.view] };
    case "back":
    case "close-compose": {
      const history = [...state.history];
      const previous = history.pop() ?? "list";
      return { view: previous === state.view ? "list" : previous, history };
    }
    default:
      return state;
  }
}
