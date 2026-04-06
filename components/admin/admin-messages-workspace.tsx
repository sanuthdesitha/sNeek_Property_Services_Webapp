"use client";

import { useEffect, useMemo, useState } from "react";
import { Loader2, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/hooks/use-toast";

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

type MessageRow = {
  id: string;
  body: string;
  isFromAdmin: boolean;
  createdAt: string;
  sentBy: {
    id: string;
    name: string | null;
    email: string | null;
    role: string;
  };
};

export function AdminMessagesWorkspace() {
  const [clients, setClients] = useState<ClientSummary[]>([]);
  const [selectedClientId, setSelectedClientId] = useState("");
  const [messages, setMessages] = useState<MessageRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [body, setBody] = useState("");

  const selectedClient = useMemo(
    () => clients.find((client) => client.id === selectedClientId) ?? null,
    [clients, selectedClientId]
  );

  async function loadClients() {
    const response = await fetch("/api/admin/messages", { cache: "no-store" });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload?.error ?? "Could not load threads.");
    const nextClients = Array.isArray(payload?.clients) ? payload.clients : [];
    setClients(nextClients);
    if (!selectedClientId && nextClients[0]?.id) {
      setSelectedClientId(nextClients[0].id);
    }
  }

  async function loadMessages(clientId: string) {
    const response = await fetch(`/api/admin/messages?clientId=${encodeURIComponent(clientId)}`, {
      cache: "no-store",
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload?.error ?? "Could not load messages.");
    setMessages(Array.isArray(payload?.messages) ? payload.messages : []);
    if (Array.isArray(payload?.clients)) {
      setClients(payload.clients);
    }
  }

  useEffect(() => {
    let active = true;
    loadClients()
      .catch((error: any) => {
        if (!active) return;
        toast({
          title: "Load failed",
          description: error?.message ?? "Could not load messages.",
          variant: "destructive",
        });
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    const timer = window.setInterval(() => {
      loadClients().catch(() => undefined);
      if (selectedClientId) {
        loadMessages(selectedClientId).catch(() => undefined);
      }
    }, 10000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [selectedClientId]);

  useEffect(() => {
    if (!selectedClientId) return;
    loadMessages(selectedClientId).catch((error: any) => {
      toast({
        title: "Load failed",
        description: error?.message ?? "Could not load the selected thread.",
        variant: "destructive",
      });
    });
  }, [selectedClientId]);

  async function sendMessage() {
    if (!selectedClientId || !body.trim()) return;
    setSending(true);
    try {
      const response = await fetch("/api/admin/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientId: selectedClientId, body }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload?.error ?? "Could not send message.");
      }
      setBody("");
      setMessages((current) => [...current, payload]);
      await loadClients();
      toast({ title: "Message sent" });
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

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Client Messages</h1>
        <p className="text-sm text-muted-foreground">
          Review every client thread in one place and reply without leaving the admin portal.
        </p>
      </div>

      <div className="grid gap-5 xl:grid-cols-[320px_1fr]">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Threads</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {loading ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                Loading...
              </div>
            ) : clients.length === 0 ? (
              <p className="text-sm text-muted-foreground">No client threads yet.</p>
            ) : (
              clients.map((client) => (
                <button
                  key={client.id}
                  type="button"
                  onClick={() => setSelectedClientId(client.id)}
                  className={`w-full rounded-2xl border px-4 py-3 text-left transition-colors ${
                    selectedClientId === client.id ? "border-primary bg-primary/10" : "bg-white hover:border-primary/20"
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate font-medium">{client.name}</p>
                      <p className="truncate text-xs text-muted-foreground">{client.email || "No email"}</p>
                    </div>
                    {client._count.messages > 0 ? (
                      <span className="rounded-full bg-destructive px-2 py-0.5 text-[11px] font-semibold text-white">
                        {client._count.messages}
                      </span>
                    ) : null}
                  </div>
                  {client.messages[0] ? (
                    <p className="mt-2 line-clamp-2 text-xs text-muted-foreground">{client.messages[0].body}</p>
                  ) : null}
                </button>
              ))
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              {selectedClient ? `Thread with ${selectedClient.name}` : "Select a client"}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="max-h-[60vh] space-y-3 overflow-y-auto rounded-2xl border bg-muted/20 p-4">
              {selectedClientId ? (
                messages.length > 0 ? (
                  messages.map((message) => (
                    <div
                      key={message.id}
                      className={`max-w-[85%] rounded-2xl px-4 py-3 text-sm ${
                        message.isFromAdmin
                          ? "ml-auto bg-primary text-primary-foreground"
                          : "border bg-white text-foreground"
                      }`}
                    >
                      <p className="font-medium">
                        {message.isFromAdmin ? "Admin" : message.sentBy?.name || "Client"}
                      </p>
                      <p className="mt-1 whitespace-pre-wrap">{message.body}</p>
                      <p className={`mt-2 text-[11px] ${message.isFromAdmin ? "text-primary-foreground/80" : "text-muted-foreground"}`}>
                        {new Date(message.createdAt).toLocaleString("en-AU")}
                      </p>
                    </div>
                  ))
                ) : (
                  <p className="text-sm text-muted-foreground">No messages in this thread yet.</p>
                )
              ) : (
                <p className="text-sm text-muted-foreground">Select a client thread first.</p>
              )}
            </div>

            <div className="space-y-3">
              <Textarea
                rows={4}
                value={body}
                onChange={(event) => setBody(event.target.value)}
                placeholder={selectedClientId ? "Write a reply" : "Select a client first"}
                disabled={!selectedClientId}
              />
              <div className="flex justify-end">
                <Button onClick={sendMessage} disabled={!selectedClientId || sending || !body.trim()}>
                  {sending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Send className="mr-2 h-4 w-4" />}
                  Send reply
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
