"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "@/hooks/use-toast";

type NotificationChannel = "EMAIL" | "SMS";

interface NotificationTestFormProps {
  defaultTo?: string | null;
}

export function NotificationTestForm({ defaultTo }: NotificationTestFormProps) {
  const [channel, setChannel] = useState<NotificationChannel>("EMAIL");
  const [to, setTo] = useState(defaultTo ?? "");
  const [sending, setSending] = useState(false);

  async function sendTest() {
    setSending(true);
    try {
      const res = await fetch("/api/admin/notifications/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ to, channel }),
      });
      const payload = await res.json();
      if (!res.ok || payload.ok === false) {
        throw new Error(payload.error ?? "Failed to send test notification.");
      }

      toast({
        title: "Test sent",
        description: `${channel === "EMAIL" ? "Email" : "SMS"} sent to ${to}.`,
      });
    } catch (err: any) {
      toast({
        title: "Test failed",
        description: err.message ?? "Failed to send test notification.",
        variant: "destructive",
      });
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-3">
        <div className="space-y-1.5 sm:col-span-1">
          <Label htmlFor="notification-channel">Channel</Label>
          <Select value={channel} onValueChange={(v: NotificationChannel) => setChannel(v)}>
            <SelectTrigger id="notification-channel">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="EMAIL">Email</SelectItem>
              <SelectItem value="SMS">SMS</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1.5 sm:col-span-2">
          <Label htmlFor="notification-to">{channel === "EMAIL" ? "Email address" : "Phone number (E.164)"}</Label>
          <Input
            id="notification-to"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            placeholder={channel === "EMAIL" ? "name@example.com" : "+61400000000"}
          />
        </div>
      </div>

      <div className="flex items-center justify-between gap-3">
        <p className="text-xs text-muted-foreground">This sends a real notification using configured providers.</p>
        <Button onClick={sendTest} disabled={sending || !to.trim()}>
          {sending ? "Sending..." : "Send test"}
        </Button>
      </div>
    </div>
  );
}
