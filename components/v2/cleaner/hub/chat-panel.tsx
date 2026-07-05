"use client";

/**
 * Native Estate CHAT panel for the v2 cleaner team hub.
 *
 * Wires the SAME endpoints the v1 `staff-workforce-hub` chat tab uses:
 *   - Channel list:  `GET /api/me/workforce` → `data.channels` (passed in as prop)
 *   - Open a channel: `GET /api/chat/channels/[id]/messages`
 *   - Send:          `POST /api/chat/channels/[id]/messages`  { body, attachments }
 *   - Edit own msg:  `PATCH /api/chat/channels/[id]/messages/[msgId]` { body }
 *   - Delete own msg:`PATCH /api/chat/channels/[id]/messages/[msgId]` { delete: true }
 *   - Open a direct chat: `POST /api/me/workforce` { action: "OPEN_DIRECT_CHAT", otherUserId }
 *
 * Poll for new messages every ~10s (v1 polls every 3s; brief matched ~10s cadence).
 * All UI is native Estate (`--e-*`, primitives, fields). No v1 UI imports.
 */
import * as React from "react";
import {
  Loader2,
  Send,
  Pencil,
  Trash2,
  Pin,
  MessageCircle,
  Check,
  X,
  Paperclip,
} from "lucide-react";
import { EBadge, EButton, ECard, ECardBody, EEmptyState } from "@/components/v2/ui/primitives";
import { ETextarea } from "@/components/v2/cleaner/fields";

interface ChannelSummary {
  id: string;
  name: string;
  description: string | null;
  kind: string;
  unreadCount?: number;
  pinnedCount?: number;
  lastMessage?: { body: string; senderName: string | null } | null;
}
interface DirectoryMember {
  id: string;
  name: string | null;
  email: string;
  role?: string;
}
interface ChatMessage {
  id: string;
  body: string;
  createdAt: string;
  isPinned?: boolean;
  sender?: { id: string; name?: string | null; role?: string | null } | null;
  attachments?: Array<{ url: string; fileName?: string | null; mimeType?: string | null; label?: string | null }> | null;
}

const POLL_MS = 10_000;

function dayLabel(iso: string) {
  const date = new Date(iso);
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const key = date.toDateString();
  if (key === today.toDateString()) return "Today";
  if (key === yesterday.toDateString()) return "Yesterday";
  return date.toLocaleDateString("en-AU", { day: "2-digit", month: "short", year: "numeric" });
}
function clockLabel(iso: string) {
  return new Date(iso).toLocaleTimeString("en-AU", { hour: "2-digit", minute: "2-digit" });
}

export function ChatPanel({
  channels,
  directory,
  myUserId,
  onOpenDirectChat,
}: {
  channels: ChannelSummary[];
  directory: DirectoryMember[];
  myUserId: string | null;
  /** Opens a direct chat via the shared workforce action and returns the new channel id. */
  onOpenDirectChat: (otherUserId: string) => Promise<string | null>;
}) {
  const [selectedId, setSelectedId] = React.useState<string>(channels[0]?.id ?? "");
  const [messages, setMessages] = React.useState<ChatMessage[]>([]);
  const [loadingMessages, setLoadingMessages] = React.useState(false);
  const [draft, setDraft] = React.useState("");
  const [sending, setSending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [editingId, setEditingId] = React.useState<string>("");
  const [editDraft, setEditDraft] = React.useState("");
  const [directTarget, setDirectTarget] = React.useState("");
  const [openingDirect, setOpeningDirect] = React.useState(false);
  const scrollRef = React.useRef<HTMLDivElement | null>(null);

  // Keep a selected channel even as the channel list refreshes.
  React.useEffect(() => {
    if (!selectedId && channels[0]?.id) setSelectedId(channels[0].id);
  }, [channels, selectedId]);

  const loadMessages = React.useCallback(
    async (channelId: string, opts?: { silent?: boolean }) => {
      if (!channelId) {
        setMessages([]);
        return;
      }
      if (!opts?.silent) setLoadingMessages(true);
      try {
        const res = await fetch(`/api/chat/channels/${channelId}/messages`, { cache: "no-store" });
        const json = await res.json().catch(() => []);
        if (!res.ok) throw new Error(json?.error || "Could not load channel.");
        setMessages(Array.isArray(json) ? json : []);
        setError(null);
      } catch (e: any) {
        if (!opts?.silent) setError(e?.message || "Could not load channel.");
      } finally {
        if (!opts?.silent) setLoadingMessages(false);
      }
    },
    []
  );

  // Load + poll on channel change.
  React.useEffect(() => {
    if (!selectedId) return;
    void loadMessages(selectedId);
    const timer = window.setInterval(() => void loadMessages(selectedId, { silent: true }), POLL_MS);
    return () => window.clearInterval(timer);
  }, [selectedId, loadMessages]);

  // Auto-scroll to newest.
  React.useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages.length, selectedId]);

  const grouped = React.useMemo(() => {
    const groups: Array<{ label: string; items: ChatMessage[] }> = [];
    for (const m of messages) {
      const label = dayLabel(m.createdAt);
      const last = groups[groups.length - 1];
      if (!last || last.label !== label) groups.push({ label, items: [m] });
      else last.items.push(m);
    }
    return groups;
  }, [messages]);

  async function send() {
    if (!selectedId || !draft.trim() || sending) return;
    setSending(true);
    try {
      const res = await fetch(`/api/chat/channels/${selectedId}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body: draft.trim(), attachments: [] }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error || "Could not send message.");
      setDraft("");
      await loadMessages(selectedId, { silent: true });
    } catch (e: any) {
      setError(e?.message || "Could not send message.");
    } finally {
      setSending(false);
    }
  }

  async function patchMessage(messageId: string, payload: Record<string, unknown>) {
    if (!selectedId) return;
    try {
      const res = await fetch(`/api/chat/channels/${selectedId}/messages/${messageId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error || "Could not update message.");
      setEditingId("");
      setEditDraft("");
      await loadMessages(selectedId, { silent: true });
    } catch (e: any) {
      setError(e?.message || "Could not update message.");
    }
  }

  async function openDirect() {
    if (!directTarget || openingDirect) return;
    setOpeningDirect(true);
    try {
      const id = await onOpenDirectChat(directTarget);
      if (id) {
        setSelectedId(id);
        setDirectTarget("");
      }
    } catch (e: any) {
      setError(e?.message || "Could not open direct chat.");
    } finally {
      setOpeningDirect(false);
    }
  }

  const activeChannel = channels.find((c) => c.id === selectedId) ?? null;
  const others = directory.filter((m) => m.id !== myUserId);

  return (
    <div className="grid gap-4 lg:grid-cols-[300px,1fr]">
      {/* Channel list */}
      <ECard className="h-fit">
        <ECardBody className="space-y-4 pt-6">
          <div className="space-y-2">
            <p className="e-eyebrow">Direct message</p>
            <div className="flex gap-2">
              <select
                value={directTarget}
                onChange={(e) => setDirectTarget(e.target.value)}
                className="h-9 flex-1 rounded-[var(--e-radius-sm)] border border-[hsl(var(--e-border-strong))] bg-[hsl(var(--e-surface-sunken))] px-2 text-[0.8125rem] text-[hsl(var(--e-foreground))]"
              >
                <option value="">Select person…</option>
                {others.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name || m.email}
                  </option>
                ))}
              </select>
              <EButton size="sm" variant="outline" disabled={!directTarget || openingDirect} onClick={() => void openDirect()}>
                {openingDirect ? <Loader2 className="h-4 w-4 animate-spin" /> : <MessageCircle className="h-4 w-4" />}
              </EButton>
            </div>
          </div>

          <div className="space-y-1.5">
            {channels.length === 0 ? (
              <p className="text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">No channels yet.</p>
            ) : (
              channels.map((c) => {
                const active = c.id === selectedId;
                return (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => setSelectedId(c.id)}
                    className={`w-full rounded-[var(--e-radius)] border px-3 py-2.5 text-left transition-colors duration-[160ms] ${
                      active
                        ? "border-[hsl(var(--e-primary))] bg-[hsl(var(--e-primary-soft))]"
                        : "border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface))] hover:bg-[hsl(var(--e-muted))]"
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <p className="min-w-0 flex-1 truncate text-[0.875rem] font-[550]">{c.name}</p>
                      {c.unreadCount ? <EBadge tone="danger" soft>{c.unreadCount}</EBadge> : null}
                      {c.pinnedCount ? (
                        <span className="text-[hsl(var(--e-gold-ink))]">
                          <Pin className="h-3 w-3" />
                        </span>
                      ) : null}
                    </div>
                    {c.lastMessage ? (
                      <p className="mt-0.5 truncate text-[0.75rem] text-[hsl(var(--e-text-faint))]">
                        {c.lastMessage.senderName || "Team"}: {c.lastMessage.body}
                      </p>
                    ) : (
                      <p className="mt-0.5 truncate text-[0.75rem] text-[hsl(var(--e-text-faint))]">
                        {c.description || c.kind}
                      </p>
                    )}
                  </button>
                );
              })
            )}
          </div>
        </ECardBody>
      </ECard>

      {/* Conversation */}
      <ECard className="flex min-h-[520px] flex-col">
        <div className="border-b border-[hsl(var(--e-border))] px-6 py-4">
          <p className="text-[0.9375rem] font-[550]">{activeChannel?.name || "Select a channel"}</p>
          <p className="text-[0.75rem] text-[hsl(var(--e-text-faint))]">
            {activeChannel?.description || "Messages sync across the team."}
          </p>
        </div>

        {error ? (
          <p className="px-6 pt-3 text-[0.8125rem] text-[hsl(var(--e-danger))]">{error}</p>
        ) : null}

        <div ref={scrollRef} className="flex-1 space-y-4 overflow-y-auto px-6 py-4">
          {!selectedId ? (
            <EEmptyState eyebrow="Chat" title="No channel selected" description="Pick a channel or start a direct message." />
          ) : loadingMessages && messages.length === 0 ? (
            <div className="flex justify-center py-10 text-[hsl(var(--e-muted-foreground))]">
              <Loader2 className="h-5 w-5 animate-spin" />
            </div>
          ) : messages.length === 0 ? (
            <EEmptyState eyebrow="Quiet" title="No messages yet" description="Say hello to your team." />
          ) : (
            grouped.map((group) => (
              <div key={group.label} className="space-y-3">
                <div className="flex justify-center">
                  <span className="rounded-[var(--e-radius-pill)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface-raised))] px-3 py-0.5 text-[0.6875rem] font-[550] uppercase tracking-[0.08em] text-[hsl(var(--e-muted-foreground))]">
                    {group.label}
                  </span>
                </div>
                {group.items.map((m) => {
                  const mine = !!myUserId && m.sender?.id === myUserId;
                  const editing = editingId === m.id;
                  return (
                    <div key={m.id} className={`flex ${mine ? "justify-end" : "justify-start"}`}>
                      <div className={`max-w-[78%] ${mine ? "items-end" : "items-start"} flex flex-col gap-1`}>
                        <div className="flex items-center gap-2 px-1 text-[0.6875rem] text-[hsl(var(--e-text-faint))]">
                          <span>{mine ? "You" : m.sender?.name || m.sender?.role || "Team"}</span>
                          {m.isPinned ? (
                            <span className="inline-flex items-center gap-0.5 text-[hsl(var(--e-gold-ink))]">
                              <Pin className="h-3 w-3" /> pinned
                            </span>
                          ) : null}
                          <span>{clockLabel(m.createdAt)}</span>
                        </div>
                        <div
                          className={`rounded-[var(--e-radius-lg)] border px-3.5 py-2.5 ${
                            mine
                              ? "border-[hsl(var(--e-primary))] bg-[hsl(var(--e-primary-soft))]"
                              : "border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface-raised))]"
                          } ${m.isPinned ? "ring-1 ring-[hsl(var(--e-gold)/0.4)]" : ""}`}
                        >
                          {editing ? (
                            <div className="space-y-2">
                              <ETextarea value={editDraft} onChange={(e) => setEditDraft(e.target.value)} className="min-h-[64px] bg-[hsl(var(--e-surface))]" />
                              <div className="flex gap-2">
                                <EButton size="sm" disabled={!editDraft.trim()} onClick={() => void patchMessage(m.id, { body: editDraft.trim() })}>
                                  <Check className="h-4 w-4" /> Save
                                </EButton>
                                <EButton size="sm" variant="ghost" onClick={() => { setEditingId(""); setEditDraft(""); }}>
                                  <X className="h-4 w-4" /> Cancel
                                </EButton>
                              </div>
                            </div>
                          ) : (
                            <p className="whitespace-pre-wrap text-[0.875rem] leading-relaxed text-[hsl(var(--e-foreground))]">
                              {m.body}
                            </p>
                          )}
                          {(m.attachments?.length ?? 0) > 0 ? (
                            <div className="mt-2 space-y-1.5">
                              {m.attachments!.map((a) => {
                                const isImage = String(a.mimeType ?? "").startsWith("image/");
                                return (
                                  <a
                                    key={a.url}
                                    href={a.url}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="block overflow-hidden rounded-[var(--e-radius)] border border-[hsl(var(--e-border))]"
                                  >
                                    {isImage ? (
                                      // eslint-disable-next-line @next/next/no-img-element
                                      <img src={a.url} alt={a.fileName || "Attachment"} className="max-h-48 w-full object-cover" />
                                    ) : (
                                      <span className="flex items-center gap-1.5 px-2.5 py-1.5 text-[0.75rem] text-[hsl(var(--e-text-secondary))]">
                                        <Paperclip className="h-3 w-3" /> {a.fileName || a.label || "Attachment"}
                                      </span>
                                    )}
                                  </a>
                                );
                              })}
                            </div>
                          ) : null}
                        </div>
                        {mine && !editing ? (
                          <div className="flex gap-1 px-1">
                            <button
                              type="button"
                              onClick={() => { setEditingId(m.id); setEditDraft(m.body || ""); }}
                              className="inline-flex items-center gap-1 text-[0.6875rem] text-[hsl(var(--e-muted-foreground))] hover:text-[hsl(var(--e-foreground))]"
                            >
                              <Pencil className="h-3 w-3" /> Edit
                            </button>
                            <button
                              type="button"
                              onClick={() => void patchMessage(m.id, { delete: true })}
                              className="inline-flex items-center gap-1 text-[0.6875rem] text-[hsl(var(--e-muted-foreground))] hover:text-[hsl(var(--e-danger))]"
                            >
                              <Trash2 className="h-3 w-3" /> Delete
                            </button>
                          </div>
                        ) : null}
                      </div>
                    </div>
                  );
                })}
              </div>
            ))
          )}
        </div>

        {/* Composer */}
        <div className="border-t border-[hsl(var(--e-border))] p-4">
          <div className="flex items-end gap-2">
            <ETextarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  void send();
                }
              }}
              placeholder={selectedId ? "Write a message…  (Enter to send)" : "Select a channel first"}
              disabled={!selectedId}
              className="min-h-[44px]"
            />
            <EButton disabled={!selectedId || !draft.trim() || sending} onClick={() => void send()}>
              {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            </EButton>
          </div>
        </div>
      </ECard>
    </div>
  );
}
