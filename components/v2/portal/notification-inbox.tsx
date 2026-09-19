"use client";

import * as React from "react";
import Link from "next/link";
import { useSession } from "next-auth/react";
import * as Dialog from "@radix-ui/react-dialog";
import { Bell, ChevronDown, RefreshCw, Search, X } from "lucide-react";
import { NotificationDeviceSettings } from "@/components/notifications/notification-device-settings";
import { inboxStateSchema, nextInboxState, isInboxSnoozed, type InboxState, type InboxMutation } from "@/lib/notifications/inbox-state";
import { notificationLifecycleSchema, dispatchLabels, providerLabels, type NotificationLifecycle } from "@/lib/notifications/delivery-lifecycle";

type Row = { id: string; subject: string | null; body: string; createdAt: string; href: string; isRead?: boolean; canMarkRead?: boolean; inboxState?: InboxState; lifecycle?: NotificationLifecycle };

function internalHref(value: unknown): value is string {
  if (typeof value !== "string" || !value.startsWith("/") || value.startsWith("//")) return false;
  try {
    const decoded = decodeURIComponent(value);
    return !/[\\\s\u0000-\u001f\u007f]/.test(decoded) && !decoded.startsWith("//")
      && new URL(value, "https://portal.invalid").origin === "https://portal.invalid";
  } catch { return false; }
}

function parseRows(value: unknown): Row[] {
  if (!Array.isArray(value)) throw new Error("Invalid notification response");
  const ids = new Set<string>();
  return value.slice(0, 200).filter((row): row is Row => {
    if (!row || typeof row !== "object" || typeof row.id !== "string" || !row.id || ids.has(row.id)
      || !(row.subject === null || typeof row.subject === "string") || typeof row.body !== "string"
      || typeof row.createdAt !== "string" || !Number.isFinite(Date.parse(row.createdAt)) || !internalHref(row.href)
      || (row.isRead !== undefined && typeof row.isRead !== "boolean")
      || (row.canMarkRead !== undefined && typeof row.canMarkRead !== "boolean")
      || (row.lifecycle !== undefined && !notificationLifecycleSchema.safeParse(row.lifecycle).success)
      || (row.inboxState !== undefined && !inboxStateSchema.safeParse(row.inboxState).success)) return false;
    ids.add(row.id);
    return true;
  });
}

function parsePage(value: unknown): { items: Row[]; nextCursor: string | null } {
  if (Array.isArray(value)) return { items: parseRows(value), nextCursor: null };
  if (!value || typeof value !== "object" || !("items" in value) || !("nextCursor" in value)
    || !(value.nextCursor === null || (typeof value.nextCursor === "string"
      && value.nextCursor.length <= 1024 && /^[A-Za-z0-9_-]+$/.test(value.nextCursor)))) throw new Error("Invalid notification page");
  return { items: parseRows(value.items), nextCursor: value.nextCursor as string | null };
}

export function NotificationInbox({ accent }: { accent: string }) {
  const { data: session, status } = useSession();
  if (status !== "authenticated" || !session?.user?.id) return null;
  return <SessionInbox key={JSON.stringify([session.user.id, session.user.role, accent,
    session.impersonation?.actorId, session.impersonation?.mode, session.impersonation?.startedAt])} accent={accent} />;
}

function SessionInbox({ accent }: { accent: string }) {
  const { data: session } = useSession();
  const [open, setOpen] = React.useState(false);
  const [rows, setRows] = React.useState<Row[]>([]);
  const [query, setQuery] = React.useState("");
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState(false);
  const [nextCursor, setNextCursor] = React.useState<string | null>(null);
  const [unreadOnly, setUnreadOnly] = React.useState(false);
  const [followUpFilter, setFollowUpFilter] = React.useState("ACTIVE");
  const [savingState, setSavingState] = React.useState(false);
  const [stateError, setStateError] = React.useState(false);
  const confirmedStates = React.useRef(new Map<string, InboxState>());
  const stateLock = React.useRef(false);
  const changeState = async (row: Row, action: InboxMutation["action"], snoozedUntil?: string) => {
    if (stateLock.current || session?.impersonation || !row.inboxState) return;
    stateLock.current = true; setSavingState(true); setStateError(false);
    try {
      const response = await fetch("/api/notifications/inbox-state", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: row.id, revision: row.inboxState.revision, action, ...(snoozedUntil ? { snoozedUntil } : {}) }) });
      if (!response.ok) throw new Error();
      const result = inboxStateSchema.parse((await response.json()).state);
      const expected = nextInboxState(row.inboxState, action, snoozedUntil);
      if (result.revision !== expected.revision || result.followUp !== expected.followUp || result.archived !== expected.archived || (result.snoozedUntil ?? null) !== (expected.snoozedUntil ?? null)) throw new Error();
      if (action === "ACKNOWLEDGE" ? !result.acknowledgedAt : (result.acknowledgedAt ?? null) !== (row.inboxState.acknowledgedAt ?? null)) throw new Error();
      const previousConfirmation = confirmedStates.current.get(row.id);
      if (!previousConfirmation || previousConfirmation.revision < result.revision) confirmedStates.current.set(row.id, result);
      setRows(previous => previous.map(item => item.id === row.id && (!item.inboxState || item.inboxState.revision < result.revision) ? { ...item, inboxState: result } : item));
    } catch { setStateError(true); }
    finally { stateLock.current = false; setSavingState(false); }
  };
  const [savingRead, setSavingRead] = React.useState(false);
  const [readError, setReadError] = React.useState(false);
  const confirmedReadIds = React.useRef(new Set<string>());
  const markRead = async (id: string) => {
    if (savingRead || session?.impersonation) return;
    setSavingRead(true);
    setReadError(false);
    try {
      const response = await fetch("/api/notifications/log", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ids: [id] }) });
      if (!response.ok) throw new Error("Could not save read status");
      const result = await response.json();
      if (result.ok !== true || result.updated !== 1) throw new Error("Read status was not saved");
      confirmedReadIds.current.add(id);
      setRows(previous => previous.map(row => row.id === id ? { ...row, isRead: true, ...(row.lifecycle ? { lifecycle: { ...row.lifecycle, personalRead: "READ" as const } } : {}) } : row));
    } catch { setReadError(true); }
    finally { setSavingRead(false); }
  };
  const refreshRef = React.useRef<() => void>(() => {});
  const olderRef = React.useRef<() => void>(() => {});
  const retryRef = React.useRef<() => void>(() => {});

  React.useEffect(() => {
    if (!open) return;
    let disposed = false;
    let controller: AbortController | null = null;
    let queued = false;
    let cursor: string | null = null;
    const refresh = async (older = false) => {
      if (disposed) return;
      if (controller) { if (!older) queued = true; return; }
      if (older && !cursor) return;
      const requestedCursor = older ? cursor : null;
      controller = new AbortController();
      setLoading(true);
      setError(false);
      try {
        const response = await fetch(`/api/notifications/log?paginated=1&lifecycle=1${requestedCursor ? `&cursor=${encodeURIComponent(requestedCursor)}` : ""}`, { method: "GET", cache: "no-store", signal: controller.signal });
        if (!disposed && (response.status === 401 || response.status === 403)) {
          setRows([]); setNextCursor(null); cursor = null;
        }
        if (!response.ok) throw new Error("Could not load notifications");
        const page = parsePage(await response.json());
        if (requestedCursor && page.nextCursor === requestedCursor) throw new Error("Notification cursor did not advance");
        if (!disposed) {
          const items = page.items.map(row => {
            const confirmed = confirmedStates.current.get(row.id);
            if (row.inboxState && (!confirmed || row.inboxState.revision > confirmed.revision)) confirmedStates.current.set(row.id, row.inboxState);
            return { ...row, ...(confirmedReadIds.current.has(row.id) ? { isRead: true, ...(row.lifecycle ? { lifecycle: { ...row.lifecycle, personalRead: "READ" as const } } : {}) } : {}),
              ...(confirmed && row.inboxState && confirmed.revision > row.inboxState.revision ? { inboxState: confirmed } : {}) };
          });
          setRows((previous) => older ? Array.from(new Map([...previous, ...items].map((row) => [row.id, row])).values()) : items);
          cursor = page.nextCursor;
          setNextCursor(cursor);
        }
      } catch {
        if (!disposed) { setError(true); retryRef.current = () => { void refresh(older && Boolean(cursor)); }; }
      } finally {
        controller = null;
        if (!disposed) {
          setLoading(false);
          if (queued) { queued = false; void refresh(); }
        }
      }
    };
    refreshRef.current = () => { void refresh(); };
    olderRef.current = () => { void refresh(true); };
    retryRef.current = refreshRef.current;
    window.addEventListener("sneek:notification", refreshRef.current);
    void refresh();
    return () => {
      disposed = true;
      controller?.abort();
      window.removeEventListener("sneek:notification", refreshRef.current);
      refreshRef.current = () => {};
      olderRef.current = () => {};
      retryRef.current = () => {};
    };
  }, [open]);

  const [now, setNow] = React.useState(Date.now);
  React.useEffect(() => {
    if (!open) return;
    const updateClock = () => setNow(Date.now());
    updateClock();
    const timer = window.setInterval(updateClock, 1000);
    window.addEventListener("focus", updateClock);
    return () => { clearInterval(timer); window.removeEventListener("focus", updateClock); };
  }, [open]);
  const filtered = rows.filter((row) => (!unreadOnly || !row.isRead)
    && (followUpFilter === "ARCHIVED" ? row.inboxState?.archived : !row.inboxState?.archived)
    && (followUpFilter === "ARCHIVED" || (followUpFilter === "SNOOZED" ? isInboxSnoozed(row.inboxState, now) : !isInboxSnoozed(row.inboxState, now)))
    && (!["NEEDS_ACTION", "RESOLVED"].includes(followUpFilter) || row.inboxState?.followUp === followUpFilter)
    && `${row.subject ?? ""} ${row.body}`.toLowerCase().includes(query.trim().toLowerCase()));
  const iconButton = "flex h-11 w-11 shrink-0 items-center justify-center rounded hover:bg-black/5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 disabled:opacity-50";
  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger asChild>
        <button type="button" title="Recent notifications" aria-label="Recent notifications" className={`${iconButton} ml-auto text-[hsl(var(--e-foreground))]`}>
          <Bell aria-hidden="true" className="h-5 w-5" />
        </button>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/50 motion-reduce:animate-none" />
        <Dialog.Content data-skin="estate" data-portal-accent={accent}
          className="fixed inset-y-0 right-0 z-50 flex h-[100dvh] w-full max-w-lg flex-col border-l border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface))] text-[hsl(var(--e-foreground))] shadow-xl motion-reduce:animate-none">
          <div className="flex items-start gap-2 border-b border-[hsl(var(--e-border))] p-4">
            <div className="min-w-0 flex-1">
              <Dialog.Title className="text-lg font-semibold">Recent notifications</Dialog.Title>
              <Dialog.Description className="mt-1 text-sm text-[hsl(var(--e-muted-foreground))]">Notification history</Dialog.Description>
            </div>
            <button type="button" title="Refresh notifications" aria-label="Refresh notifications" disabled={loading} onClick={() => refreshRef.current()} className={iconButton}>
              <RefreshCw aria-hidden="true" className="h-4 w-4" />
            </button>
            <Dialog.Close title="Close notifications" aria-label="Close notifications" className={iconButton}><X aria-hidden="true" className="h-5 w-5" /></Dialog.Close>
          </div>
          <div className="relative m-4">
            <Search aria-hidden="true" className="pointer-events-none absolute left-3 top-3.5 h-4 w-4" />
            <input type="search" aria-label="Search loaded notifications" placeholder="Search loaded notifications" value={query} onChange={(event) => setQuery(event.target.value)}
              className="h-11 w-full rounded border border-[hsl(var(--e-border))] bg-transparent pl-9 pr-3 text-sm focus-visible:outline focus-visible:outline-2" />
          </div>
          <label className="mx-4 mb-3 flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" checked={unreadOnly} onChange={event => setUnreadOnly(event.target.checked)} />Unread only (loaded history)</label>
          <NotificationDeviceSettings />
          <label className="mx-4 mb-3 text-sm">Personal follow-up (loaded history)
            <select aria-label="Personal follow-up filter" className="ml-2 min-h-11 rounded border bg-transparent" value={followUpFilter} onChange={event => setFollowUpFilter(event.target.value)}>
              <option value="ACTIVE">Inbox</option><option value="NEEDS_ACTION">Needs action</option><option value="SNOOZED">Snoozed</option><option value="RESOLVED">Resolved</option><option value="ARCHIVED">Archived</option>
            </select>
          </label>
          <p className="mx-4 mb-3 text-xs">Follow-up, snooze and archive affect only your inbox. Snoozed items return when the time expires; no reminder is sent. These actions do not change the job or confirm delivery.</p>
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-6" aria-busy={loading}>
            {stateError ? <p role="alert" className="py-3 text-sm">Could not save follow-up. Refresh notifications before retrying.</p> : null}
            {readError ? <p role="alert" className="py-3 text-sm">Could not save read status. Use Mark as read to retry.</p> : null}
            {loading ? <p role="status" className="py-3 text-sm">Loading notifications...</p> : null}
            {error ? <div role="alert" className="py-3 text-sm"><p>Could not refresh notifications. Please try again.</p><button type="button" disabled={loading} onClick={() => retryRef.current()} className="mt-2 min-h-11 rounded px-3 underline focus-visible:outline focus-visible:outline-2">Retry</button></div> : null}
            {!loading && !error && !filtered.length ? <p role="status" className="py-3 text-sm">{query.trim() || unreadOnly || followUpFilter !== "ACTIVE" || rows.length > 0 ? "No matching notifications in loaded history." : nextCursor ? "No visible notifications loaded." : "No recent notifications."}</p> : null}
            <ul className="divide-y divide-[hsl(var(--e-border))]">
              {filtered.map((row) => <li key={row.id}>
                <Link href={row.href} prefetch={false} onClick={() => setOpen(false)} className="block break-words rounded px-2 py-4 hover:bg-black/5 focus-visible:outline focus-visible:outline-2 [overflow-wrap:anywhere]">
                  <p className="text-sm font-semibold">{row.subject || "Notification"}{row.isRead ? <span className="ml-2 text-xs font-normal">Read</span> : <span className="ml-2 text-xs">Unread</span>}</p>
                  <p className="mt-1 whitespace-pre-wrap text-sm">{row.body}</p>
                  <time dateTime={row.createdAt} className="mt-2 block text-xs text-[hsl(var(--e-muted-foreground))]">{new Date(row.createdAt).toLocaleString()}</time>
                </Link>
                {row.lifecycle ? <details className="mb-2 px-2 text-xs">
                  <summary className="min-h-8 cursor-pointer">Delivery details</summary>
                  <p>{dispatchLabels[row.lifecycle.dispatch]}</p>
                  <p>{providerLabels[row.lifecycle.provider]}</p>
                  <p>Personal read status: {row.lifecycle.personalRead === "NOT_APPLICABLE" ? "Not applicable" : row.isRead ? "Read" : "Unread"}</p>
                  <p>Acknowledgement: {row.inboxState?.acknowledgedAt ? "recorded by you" : "not recorded"}. Resolving a personal follow-up does not acknowledge delivery.</p>
                </details> : null}
                {!row.isRead && row.canMarkRead !== false && !session?.impersonation ? <button type="button" disabled={savingRead || loading} onClick={() => { void markRead(row.id); }} className="mb-2 min-h-11 rounded px-2 text-sm underline focus-visible:outline focus-visible:outline-2 disabled:opacity-50">Mark as read</button> : null}
                {row.inboxState ? <div className="pb-2 text-sm">
                  {row.inboxState.acknowledgedAt ? <p>Acknowledged <time dateTime={row.inboxState.acknowledgedAt}>{new Date(row.inboxState.acknowledgedAt).toLocaleString()}</time></p>
                    : !session?.impersonation ? <div><button type="button" disabled={savingState || loading} className="min-h-11 rounded px-2 underline disabled:opacity-50" onClick={() => void changeState(row, "ACKNOWLEDGE")}>Acknowledge notification</button><p className="text-xs">Records your acknowledgement only; does not complete the job or confirm provider delivery.</p></div> : null}
                  <p>Personal follow-up: {row.inboxState.followUp === "NEEDS_ACTION" ? "Needs action" : row.inboxState.followUp === "RESOLVED" ? "Resolved" : "None"}{row.inboxState.archived ? " · Archived" : ""}</p>
                  {isInboxSnoozed(row.inboxState, now) ? <p>Snoozed until <time dateTime={row.inboxState.snoozedUntil!}>{new Date(row.inboxState.snoozedUntil!).toLocaleString()}</time></p> : null}
                  {!session?.impersonation && !row.inboxState.archived ? <div className="flex flex-wrap gap-2">
                    {isInboxSnoozed(row.inboxState, now) ? <button type="button" disabled={savingState || loading} className="min-h-11 rounded px-2 underline disabled:opacity-50" onClick={() => void changeState(row, "UNSNOOZE")}>End snooze</button> : [1, 24].map(hours => <button key={hours} type="button" disabled={savingState || loading} className="min-h-11 rounded px-2 underline disabled:opacity-50" onClick={() => void changeState(row, "SNOOZE", new Date(Date.now() + hours * 60 * 60 * 1000).toISOString())}>Snooze {hours === 1 ? "1 hour" : "24 hours"}</button>)}
                  </div> : null}
                  {!session?.impersonation ? <div className="flex flex-wrap gap-2">
                    {(row.inboxState.followUp === "NEEDS_ACTION" ? [["RESOLVE", "Resolve follow-up"], ["CLEAR_FOLLOW_UP", "Clear follow-up"]] : [["NEEDS_ACTION", "Needs action"]]).concat([[row.inboxState.archived ? "RESTORE" : "ARCHIVE", row.inboxState.archived ? "Restore to inbox" : "Archive"]]).map(([action, label]) =>
                      <button key={action} type="button" className="min-h-11 rounded px-2 underline disabled:opacity-50" disabled={savingState || loading} onClick={() => void changeState(row, action as InboxMutation["action"])}>{label}</button>)}
                  </div> : null}
                </div> : null}
              </li>)}
            </ul>
            {nextCursor ? <button type="button" disabled={loading} onClick={() => olderRef.current()} className="mt-3 flex min-h-11 w-full items-center justify-center gap-2 rounded border border-[hsl(var(--e-border))] px-3 text-sm focus-visible:outline focus-visible:outline-2 disabled:opacity-50"><ChevronDown aria-hidden="true" className="h-4 w-4" />Load older notifications</button> : null}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
