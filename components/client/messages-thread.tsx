"use client";

import { useEffect, useState } from "react";
import { Loader2, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/hooks/use-toast";

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

export function ClientMessagesThread() {
  const [messages, setMessages] = useState<MessageRow[]>([]);
  const [body, setBody] = useState("");
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);

  async function loadMessages() {
    const response = await fetch("/api/client/messages", { cache: "no-store" });
    const payload = await response.json().catch(() => []);
    if (!response.ok) {
      throw new Error(payload?.error ?? "Could not load messages.");
    }
    setMessages(Array.isArray(payload) ? payload : []);
  }

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
    }, 10000);

    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, []);

  async function sendMessage() {
    if (!body.trim()) return;
    setSending(true);
    try {
      const response = await fetch("/api/client/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload?.error ?? "Could not send message.");
      }
      setBody("");
      setMessages((current) => [...current, payload]);
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
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold">Messages</h1>
        <p className="text-sm text-muted-foreground">
          Send questions or service updates directly to admin. Replies refresh automatically.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Thread</CardTitle>
          <CardDescription>All messages for your client account.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="max-h-[55vh] space-y-3 overflow-y-auto rounded-2xl border bg-muted/20 p-4">
            {loading ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                Loading messages...
              </div>
            ) : messages.length === 0 ? (
              <p className="text-sm text-muted-foreground">No messages yet.</p>
            ) : (
              messages.map((message) => (
                <div
                  key={message.id}
                  className={`max-w-[85%] rounded-2xl px-4 py-3 text-sm ${
                    message.isFromAdmin
                      ? "border bg-white text-foreground"
                      : "ml-auto bg-primary text-primary-foreground"
                  }`}
                >
                  <p className="font-medium">
                    {message.isFromAdmin ? message.sentBy?.name || "Admin" : "You"}
                  </p>
                  <p className="mt-1 whitespace-pre-wrap">{message.body}</p>
                  <p className={`mt-2 text-[11px] ${message.isFromAdmin ? "text-muted-foreground" : "text-primary-foreground/80"}`}>
                    {new Date(message.createdAt).toLocaleString("en-AU")}
                  </p>
                </div>
              ))
            )}
          </div>

          <div className="space-y-3">
            <Textarea
              rows={4}
              value={body}
              onChange={(event) => setBody(event.target.value)}
              placeholder="Write your message to admin"
            />
            <div className="flex justify-end">
              <Button onClick={sendMessage} disabled={sending || !body.trim()}>
                {sending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Send className="mr-2 h-4 w-4" />}
                Send message
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
