"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, Loader2, MessageSquare, Search, Send } from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "@/hooks/use-toast";
import {
  Avatar,
  Composer,
  MessageList,
  relativeListTime,
  type ChatMessage,
} from "@/components/messaging/chat-primitives";

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
  _count: {
    messages: number;
  };
};

const REFRESH_MS = 10_000;

export function AdminMessagesWorkspace() {
  const [clients, setClients] = useState<ClientSummary[]>([]);
  const [selectedClientId, setSelectedClientId] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loadingClients, setLoadingClients] = useState(true);
  const [loadingThread, setLoadingThread] = useState(false);
  const [sending, setSending] = useState(false);
  const [body, setBody] = useState("");
  const [search, setSearch] = useState("");

  // keep selectedClientId fresh inside the interval without re-arming it
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
    const nextClients: ClientSummary[] = Array.isArray(payload?.clients) ? payload.clients : [];
    setClients(nextClients);
    return nextClients;
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

  // Initial load + light polling.
  useEffect(() => {
    let active = true;
    loadClients()
      .then((next) => {
        if (active && !selectedRef.current && next[0]?.id) {
          setSelectedClientId(next[0].id);
        }
      })
      .catch((error: any) =>
        toast({
          title: "Load failed",
          description: error?.message ?? "Could not load messages.",
          variant: "destructive",
        })
      )
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

  // Load thread when selection changes.
  useEffect(() => {
    if (!selectedClientId) {
      setMessages([]);
      return;
    }
    setLoadingThread(true);
    setMessages([]);
    loadMessages(selectedClientId)
      .catch((error: any) =>
        toast({
          title: "Load failed",
          description: error?.message ?? "Could not load the selected thread.",
          variant: "destructive",
        })
      )
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
    } catch (error: any) {
      toast({
        title: "Send failed",
        description: error?.message ?? "Could not send message.",
        variant: "destructive",
      });
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
    // Negative margins cancel the admin <main> padding so the messenger is
    // truly full-height and only the thread scrolls (no page scroll).
    <div className="-mx-3 -my-4 flex h-[calc(100dvh-3.5rem)] overflow-hidden bg-background sm:-mx-4 md:-mx-6 md:-my-6">
      {/* LEFT — conversation list */}
      <aside
        className={cn(
          "flex w-full shrink-0 flex-col border-r border-border bg-card md:w-[340px] lg:w-[380px]",
          selectedClientId ? "hidden md:flex" : "flex"
        )}
      >
        <div className="flex shrink-0 items-center justify-between gap-2 border-b border-border px-4 py-3">
          <div className="flex items-center gap-2">
            <MessageSquare className="h-5 w-5 text-primary" />
            <h1 className="text-base font-semibold">Messages</h1>
          </div>
          <a
            href="/admin/messages/compose"
            className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-input bg-background px-3 text-xs font-medium shadow-sm transition-colors hover:bg-accent"
          >
            <Send className="h-3.5 w-3.5" />
            Email / SMS
          </a>
        </div>

        <div className="shrink-0 px-3 py-2.5">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search clients or messages"
              className="h-11 w-full rounded-full border border-input bg-surface pl-9 pr-3 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto overscroll-contain px-2 pb-2">
          {loadingClients ? (
            <div className="flex items-center gap-2 px-3 py-4 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading…
            </div>
          ) : filteredClients.length === 0 ? (
            <p className="px-3 py-6 text-center text-sm text-muted-foreground">
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
                    "flex w-full items-center gap-3 rounded-xl px-2.5 py-2.5 text-left transition-colors",
                    active ? "bg-primary/10" : "hover:bg-accent"
                  )}
                >
                  <Avatar name={client.name} size={46} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="truncate text-sm font-semibold text-foreground">
                        {client.name}
                      </span>
                      {last ? (
                        <span
                          className={cn(
                            "shrink-0 text-[11px]",
                            unread > 0 ? "font-semibold text-primary" : "text-muted-foreground"
                          )}
                        >
                          {relativeListTime(last.createdAt)}
                        </span>
                      ) : null}
                    </div>
                    <div className="mt-0.5 flex items-center justify-between gap-2">
                      <span
                        className={cn(
                          "truncate text-xs",
                          unread > 0 ? "font-medium text-foreground" : "text-muted-foreground"
                        )}
                      >
                        {last
                          ? `${last.isFromAdmin ? "You: " : ""}${last.body}`
                          : client.email || "No messages yet"}
                      </span>
                      {unread > 0 ? (
                        <span className="flex h-5 min-w-[20px] shrink-0 items-center justify-center rounded-full bg-primary px-1.5 text-[11px] font-semibold text-primary-foreground">
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
          "min-w-0 flex-1 flex-col bg-muted/10",
          selectedClientId ? "flex" : "hidden md:flex"
        )}
      >
        {selectedClient ? (
          <>
            <header className="flex shrink-0 items-center gap-3 border-b border-border bg-card/80 px-3 py-2.5 backdrop-blur-xl sm:px-4">
              <button
                type="button"
                onClick={() => setSelectedClientId("")}
                className="flex h-9 w-9 items-center justify-center rounded-full text-muted-foreground hover:bg-accent md:hidden"
                aria-label="Back to conversations"
              >
                <ArrowLeft className="h-5 w-5" />
              </button>
              <Avatar name={selectedClient.name} size={40} />
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-foreground">
                  {selectedClient.name}
                </p>
                <p className="truncate text-xs text-muted-foreground">
                  {selectedClient.email || "Client"}
                </p>
              </div>
            </header>

            <MessageList
              messages={messages}
              mineIsFromAdmin
              loading={loadingThread}
              emptyTitle="No messages in this thread yet"
              emptyHint="Send the first message below."
            />

            <Composer
              value={body}
              onChange={setBody}
              onSend={sendMessage}
              sending={sending}
              placeholder={`Message ${selectedClient.name.split(" ")[0] || "client"}`}
            />
          </>
        ) : (
          <div className="flex flex-1 flex-col items-center justify-center gap-2 px-6 text-center">
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-primary/10">
              <MessageSquare className="h-7 w-7 text-primary" />
            </div>
            <p className="text-sm font-medium text-foreground">Select a conversation</p>
            <p className="max-w-xs text-xs text-muted-foreground">
              Pick a client on the left to read and reply to their thread.
            </p>
          </div>
        )}
      </section>
    </div>
  );
}
