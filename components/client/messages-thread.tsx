"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "@/hooks/use-toast";
import {
  Avatar,
  Composer,
  MessageList,
  type ChatMessage,
} from "@/components/messaging/chat-primitives";

const REFRESH_MS = 10_000;

export function ClientMessagesThread() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [body, setBody] = useState("");
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);

  const loadMessages = useCallback(async () => {
    const response = await fetch("/api/client/messages", { cache: "no-store" });
    const payload = await response.json().catch(() => []);
    if (!response.ok) {
      throw new Error((payload as any)?.error ?? "Could not load messages.");
    }
    setMessages(Array.isArray(payload) ? payload : []);
  }, []);

  useEffect(() => {
    let active = true;
    loadMessages()
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
      loadMessages().catch(() => undefined);
    }, REFRESH_MS);

    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [loadMessages]);

  async function sendMessage() {
    if (!body.trim()) return;
    setSending(true);
    const text = body;
    try {
      const response = await fetch("/api/client/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body: text }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload?.error ?? "Could not send message.");
      setBody("");
      setMessages((current) => [...current, payload]);
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
    // Cancel the portal <main> padding (p-4 pb-24 sm:p-5 md:p-6) so the thread
    // fills the viewport and only the message list scrolls.
    <div className="-mx-4 -my-4 -mb-24 flex h-[calc(100dvh-3.5rem)] flex-col overflow-hidden bg-muted/10 sm:-mx-5 sm:-my-5 md:-mx-6 md:-my-6 md:-mb-6">
      <header className="flex shrink-0 items-center gap-3 border-b border-border bg-card/80 px-4 py-3 backdrop-blur-xl">
        <Avatar name="sNeek Property" size={40} />
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-foreground">sNeek Property Services</p>
          <p className="truncate text-xs text-muted-foreground">Support &amp; service updates</p>
        </div>
      </header>

      <MessageList
        messages={messages}
        mineIsFromAdmin={false}
        showSenderNames
        loading={loading}
        emptyTitle="Start the conversation"
        emptyHint="Send a question or service update to the sNeek team. Replies refresh automatically."
      />

      <Composer
        value={body}
        onChange={setBody}
        onSend={sendMessage}
        sending={sending}
        placeholder="Message the sNeek team"
      />
    </div>
  );
}
