"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Loader2, MessageSquare, Search, Send } from "lucide-react";
import { cn } from "@/lib/utils";
import { EAvatar } from "@/components/v2/admin/estate-kit";
import {
  EComposer,
  EMessageList,
  relativeListTime,
  type EChatMessage,
} from "@/components/v2/admin/messages/estate-chat";

type ClientSummary = {
  id: string;
  name: string;
  email: string | null;
  updatedAt: string;
  messages: Array<{
    id: string;
    body: string;
    createdAt: string;
    isFromAdmin: boolean;
    isRead: boolean;
  }>;
  _count: { messages: number };
};

const REFRESH_MS = 10_000;

export function EstateMessagesWorkspace() {
  const [clients, setClients] = useState<ClientSummary[]>([]);
  const [selectedClientId, setSelectedClientId] = useState("");
  const [messages, setMessages] = useState<EChatMessage[]>([]);
  const [loadingClients, setLoadingClients] = useState(true);
  const [loadingThread, setLoadingThread] = useState(false);
  const [sending, setSending] = useState(false);
  const [body, setBody] = useState("");
  const [search, setSearch] = useState("");
  const [error, setError] = useState<string | null>(null);

  const selectedRef = useRef(selectedClientId);
  selectedRef.current = selectedClientId;

  const selectedClient = useMemo(
    () => clients.find((client) => client.id === selectedClientId) ?? null,
    [clients, selectedClientId]
  );

  const loadClients = useCallback(async () => {
    const response = await fetch("/api/admin/messages", { cache: "no-store" });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload?.error ?? "Could not load threads.");
    const next: ClientSummary[] = Array.isArray(payload?.clients) ? payload.clients : [];
    setClients(next);
    return next;
  }, []);

  const loadMessages = useCallback(async (clientId: string) => {
    const response = await fetch(`/api/admin/messages?clientId=${encodeURIComponent(clientId)}`, {
      cache: "no-store",
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload?.error ?? "Could not load messages.");
    setMessages(Array.isArray(payload?.messages) ? payload.messages : []);
    if (Array.isArray(payload?.clients)) setClients(payload.clients);
  }, []);

  useEffect(() => {
    let active = true;
    loadClients()
      .then((next) => {
        if (active && !selectedRef.current && next[0]?.id) setSelectedClientId(next[0].id);
      })
      .catch((err: any) => setError(err?.message ?? "Could not load messages."))
      .finally(() => {
        if (active) setLoadingClients(false);
      });

    const timer = window.setInterval(() => {
      loadClients().catch(() => undefined);
      if (selectedRef.current) loadMessages(selectedRef.current).catch(() => undefined);
    }, REFRESH_MS);

    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [loadClients, loadMessages]);

  useEffect(() => {
    if (!selectedClientId) {
      setMessages([]);
      return;
    }
    setLoadingThread(true);
    setMessages([]);
    loadMessages(selectedClientId)
      .catch((err: any) => setError(err?.message ?? "Could not load the thread."))
      .finally(() => setLoadingThread(false));
  }, [selectedClientId, loadMessages]);

  async function sendMessage() {
    if (!selectedClientId || !body.trim()) return;
    setSending(true);
    const text = body;
    try {
      const response = await fetch("/api/admin/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientId: selectedClientId, body: text }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload?.error ?? "Could not send message.");
      setBody("");
      setMessages((current) => [...current, payload]);
      loadClients().catch(() => undefined);
    } catch (err: any) {
      setError(err?.message ?? "Could not send message.");
    } finally {
      setSending(false);
    }
  }

  const filteredClients = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return clients;
    return clients.filter(
      (client) =>
        client.name.toLowerCase().includes(q) ||
        (client.email ?? "").toLowerCase().includes(q) ||
        (client.messages[0]?.body ?? "").toLowerCase().includes(q)
    );
  }, [clients, search]);

  return (
    // Cancel the portal shell padding so the messenger is full-height and only
    // the thread scrolls.
    <div className="-mx-4 -my-6 flex h-[calc(100dvh-4rem)] overflow-hidden rounded-none bg-[hsl(var(--e-background))] md:-mx-6 lg:-mx-8">
      {/* LEFT — conversation list */}
      <aside
        className={cn(
          "flex w-full shrink-0 flex-col border-r border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface))] md:w-[340px] lg:w-[380px]",
          selectedClientId ? "hidden md:flex" : "flex"
        )}
      >
        <div className="flex shrink-0 items-center justify-between gap-2 border-b border-[hsl(var(--e-border))] px-4 py-3">
          <div className="flex items-center gap-2">
            <MessageSquare className="h-5 w-5 text-[hsl(var(--e-accent-portal))]" />
            <h1 className="text-[1rem] font-semibold text-[hsl(var(--e-foreground))]">Messages</h1>
          </div>
          <Link
            href="/v2/admin/messages/compose"
            className="inline-flex h-9 items-center gap-1.5 rounded-[var(--e-radius)] border border-[hsl(var(--e-border-strong))] bg-[hsl(var(--e-surface))] px-3 text-[0.75rem] font-[550] text-[hsl(var(--e-foreground))] shadow-[var(--e-elevation-1)] transition-colors hover:bg-[hsl(var(--e-muted))]"
          >
            <Send className="h-3.5 w-3.5" />
            Email / SMS
          </Link>
        </div>

        <div className="shrink-0 px-3 py-2.5">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[hsl(var(--e-muted-foreground))]" />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search clients or messages"
              className="h-11 w-full rounded-[var(--e-radius-pill)] border border-[hsl(var(--e-input))] bg-[hsl(var(--e-surface-raised))] pl-9 pr-3 text-[0.875rem] text-[hsl(var(--e-foreground))] placeholder:text-[hsl(var(--e-text-faint))] focus:outline-none focus:border-[hsl(var(--e-gold))] focus:ring-1 focus:ring-[hsl(var(--e-ring))]"
            />
          </div>
        </div>

        {error ? (
          <p className="mx-3 mb-2 rounded-[var(--e-radius)] border border-[hsl(var(--e-danger)/0.4)] bg-[hsl(var(--e-danger-soft))] px-3 py-2 text-[0.75rem] text-[hsl(var(--e-foreground))]">
            {error}
          </p>
        ) : null}

        <div className="flex-1 overflow-y-auto overscroll-contain px-2 pb-2">
          {loadingClients ? (
            <div className="flex items-center gap-2 px-3 py-4 text-[0.875rem] text-[hsl(var(--e-muted-foreground))]">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading…
            </div>
          ) : filteredClients.length === 0 ? (
            <p className="px-3 py-6 text-center text-[0.875rem] text-[hsl(var(--e-muted-foreground))]">
              {search ? "No matches." : "No client threads yet."}
            </p>
          ) : (
            filteredClients.map((client) => {
              const last = client.messages[0];
              const unread = client._count.messages;
              const active = client.id === selectedClientId;
              return (
                <button
                  key={client.id}
                  type="button"
                  onClick={() => setSelectedClientId(client.id)}
                  className={cn(
                    "flex w-full items-center gap-3 rounded-[var(--e-radius-lg)] px-2.5 py-2.5 text-left transition-colors",
                    active ? "bg-[hsl(var(--e-primary-soft))]" : "hover:bg-[hsl(var(--e-muted))]"
                  )}
                >
                  <EAvatar name={client.name} size="lg" />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="truncate text-[0.875rem] font-semibold text-[hsl(var(--e-foreground))]">
                        {client.name}
                      </span>
                      {last ? (
                        <span
                          className={cn(
                            "shrink-0 text-[0.6875rem]",
                            unread > 0 ? "font-semibold text-[hsl(var(--e-accent-portal))]" : "text-[hsl(var(--e-muted-foreground))]"
                          )}
                        >
                          {relativeListTime(last.createdAt)}
                        </span>
                      ) : null}
                    </div>
                    <div className="mt-0.5 flex items-center justify-between gap-2">
                      <span
                        className={cn(
                          "truncate text-[0.75rem]",
                          unread > 0 ? "font-medium text-[hsl(var(--e-foreground))]" : "text-[hsl(var(--e-muted-foreground))]"
                        )}
                      >
                        {last ? `${last.isFromAdmin ? "You: " : ""}${last.body}` : client.email || "No messages yet"}
                      </span>
                      {unread > 0 ? (
                        <span className="flex h-5 min-w-[20px] shrink-0 items-center justify-center rounded-full bg-[hsl(var(--e-primary))] px-1.5 text-[0.6875rem] font-semibold text-[hsl(var(--e-primary-foreground))]">
                          {unread}
                        </span>
                      ) : null}
                    </div>
                  </div>
                </button>
              );
            })
          )}
        </div>
      </aside>

      {/* RIGHT — open conversation */}
      <section
        className={cn(
          "min-w-0 flex-1 flex-col bg-[hsl(var(--e-background))]",
          selectedClientId ? "flex" : "hidden md:flex"
        )}
      >
        {selectedClient ? (
          <>
            <header className="flex shrink-0 items-center gap-3 border-b border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface)/0.85)] px-3 py-2.5 backdrop-blur-xl sm:px-4">
              <button
                type="button"
                onClick={() => setSelectedClientId("")}
                className="flex h-9 w-9 items-center justify-center rounded-full text-[hsl(var(--e-muted-foreground))] hover:bg-[hsl(var(--e-muted))] md:hidden"
                aria-label="Back to conversations"
              >
                <ArrowLeft className="h-5 w-5" />
              </button>
              <EAvatar name={selectedClient.name} size="md" />
              <div className="min-w-0">
                <p className="truncate text-[0.875rem] font-semibold text-[hsl(var(--e-foreground))]">{selectedClient.name}</p>
                <p className="truncate text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">{selectedClient.email || "Client"}</p>
              </div>
            </header>

            <EMessageList
              messages={messages}
              loading={loadingThread}
              emptyTitle="No messages in this thread yet"
              emptyHint="Send the first message below."
            />

            <EComposer
              value={body}
              onChange={setBody}
              onSend={sendMessage}
              sending={sending}
              placeholder={`Message ${selectedClient.name.split(" ")[0] || "client"}`}
            />
          </>
        ) : (
          <div className="flex flex-1 flex-col items-center justify-center gap-2 px-6 text-center">
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-[hsl(var(--e-primary-soft))]">
              <MessageSquare className="h-7 w-7 text-[hsl(var(--e-accent-portal))]" />
            </div>
            <p className="text-[0.875rem] font-medium text-[hsl(var(--e-foreground))]">Select a conversation</p>
            <p className="max-w-xs text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
              Pick a client on the left to read and reply to their thread.
            </p>
          </div>
        )}
      </section>
    </div>
  );
}
