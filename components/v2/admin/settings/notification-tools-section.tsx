"use client";

/**
 * ESTATE — Settings › Notification tools.
 * Native port of v1's NotificationTestForm + provider status badges. Sends real
 * test notifications via POST /api/admin/notifications/test with the SAME body
 * ({ to, channel }) for both EMAIL and SMS (SMS routes through the active
 * Twilio/Cellcast provider server-side). Self-fetches AppSettings to show which
 * SMS provider is active. Native Estate styling only (--e-* tokens).
 */
import * as React from "react";
import { Bell } from "lucide-react";
import type { AppSettings } from "@/lib/settings";
import { toast } from "@/hooks/use-toast";
import {
  ECard,
  ECardHeader,
  ECardTitle,
  ECardBody,
  EEyebrow,
  EButton,
  EBadge,
} from "@/components/v2/ui/primitives";
import { EField, EInput, ESelect } from "@/components/v2/admin/estate-kit";

type Channel = "EMAIL" | "SMS";

export function NotificationToolsSection(_: { isAdmin?: boolean } = {}) {
  const [settings, setSettings] = React.useState<AppSettings | null>(null);
  const [channel, setChannel] = React.useState<Channel>("EMAIL");
  const [to, setTo] = React.useState("");
  const [sending, setSending] = React.useState(false);

  React.useEffect(() => {
    let cancelled = false;
    fetch("/api/admin/settings", { cache: "no-store" })
      .then((res) => (res.ok ? res.json() : null))
      .then((data: AppSettings | null) => {
        if (!cancelled && data) setSettings(data);
      })
      .catch(() => {
        /* status badges are best-effort; the test send reports real config errors */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const smsProvider = settings?.smsProvider ?? "none";
  const smsProviderLabel =
    smsProvider === "twilio" ? "Twilio" : smsProvider === "cellcast" ? "Cellcast" : "Disabled";

  async function sendTest() {
    const recipient = to.trim();
    if (!recipient) return;
    setSending(true);
    try {
      const res = await fetch("/api/admin/notifications/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ to: recipient, channel }),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok || payload.ok === false) {
        throw new Error(payload.error ?? "Failed to send test notification.");
      }
      toast({
        title: "Test sent",
        description: `${channel === "EMAIL" ? "Email" : "SMS"} sent to ${recipient}.`,
      });
    } catch (err: any) {
      toast({
        title: "Test failed",
        description: err?.message ?? "Failed to send test notification.",
        variant: "destructive",
      });
    } finally {
      setSending(false);
    }
  }

  return (
    <ECard>
      <ECardHeader className="flex-row items-center gap-3">
        <span className="flex h-9 w-9 items-center justify-center rounded-full border border-[hsl(var(--e-border-strong))] text-[hsl(var(--e-accent-portal))] [&>svg]:h-4 [&>svg]:w-4">
          <Bell />
        </span>
        <div>
          <EEyebrow>Communications</EEyebrow>
          <ECardTitle className="text-[1.05rem]">Notification tools</ECardTitle>
        </div>
      </ECardHeader>
      <ECardBody className="space-y-5">
        <div className="flex flex-wrap items-center gap-2">
          <EBadge tone="info" soft>
            Email provider: Resend
          </EBadge>
          <EBadge tone={smsProvider === "none" ? "neutral" : "success"} soft>
            SMS active: {smsProviderLabel}
          </EBadge>
        </div>

        <div className="grid gap-4 sm:grid-cols-3">
          <EField label="Channel" className="sm:col-span-1">
            <ESelect value={channel} onChange={(e) => setChannel(e.target.value as Channel)}>
              <option value="EMAIL">Email</option>
              <option value="SMS">SMS</option>
            </ESelect>
          </EField>

          <EField
            label={channel === "EMAIL" ? "Email address" : "Phone number (E.164)"}
            className="sm:col-span-2"
          >
            <EInput
              value={to}
              onChange={(e) => setTo(e.target.value)}
              placeholder={channel === "EMAIL" ? "name@example.com" : "+61400000000"}
              autoComplete="off"
            />
          </EField>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-[0.75rem] text-[hsl(var(--e-text-faint))]">
            This sends a real notification using the configured providers.
          </p>
          <EButton onClick={sendTest} disabled={sending || !to.trim()}>
            {sending ? "Sending…" : "Send test"}
          </EButton>
        </div>
      </ECardBody>
    </ECard>
  );
}

export default NotificationToolsSection;
