"use client";

import { useState } from "react";
import { Download, Send } from "lucide-react";
import { EButton } from "@/components/v2/ui/primitives";
import { toast } from "@/hooks/use-toast";

/**
 * Estate-native cleaner invoice actions. These mirror EXACTLY the live cleaner
 * invoice flow in `components/cleaner/dashboard-tools.tsx` — same endpoints,
 * same payload shape — but with the current-period defaults (no date range,
 * showSpentHours off, no per-job comments). That matches the v2 Pay page, which
 * shows the current month-to-date period. No new API surface is introduced.
 *
 *   download → POST /api/cleaner/invoice/download  (blob → file)
 *   send     → POST /api/cleaner/invoice/send      ({ ...payload, confirmEmail })
 *
 * The endpoints are session-scoped to the calling cleaner server-side, so no
 * cleaner id is (or should be) passed from the client.
 */

// Current-period defaults — identical field names to the live buildInvoicePayload().
function currentPeriodPayload() {
  return {
    startDate: undefined as string | undefined,
    endDate: undefined as string | undefined,
    showSpentHours: false,
    jobComments: {} as Record<string, string>,
  };
}

export function CleanerInvoiceActions() {
  const [downloading, setDownloading] = useState(false);
  const [sending, setSending] = useState(false);

  async function downloadInvoice() {
    setDownloading(true);
    try {
      const res = await fetch("/api/cleaner/invoice/download", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(currentPeriodPayload()),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        toast({
          title: "Download failed",
          description: body.error ?? "Could not download invoice PDF.",
          variant: "destructive",
        });
        return;
      }
      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "cleaner-invoice-current-period.pdf";
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
    } catch (error: any) {
      toast({
        title: "Download failed",
        description: error?.message ?? "Could not download invoice PDF.",
        variant: "destructive",
      });
    } finally {
      setDownloading(false);
    }
  }

  async function sendInvoice() {
    setSending(true);
    try {
      const res = await fetch("/api/cleaner/invoice/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...currentPeriodPayload(), confirmEmail: true }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast({
          title: "Invoice failed",
          description: body.error ?? "Could not send invoice.",
          variant: "destructive",
        });
        return;
      }
      toast({
        title: "Invoice sent",
        description: body.sentTo ? `Sent to ${body.sentTo}.` : "Your invoice has been submitted.",
      });
    } catch (error: any) {
      toast({
        title: "Invoice failed",
        description: error?.message ?? "Could not send invoice.",
        variant: "destructive",
      });
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <EButton variant="outline" size="sm" disabled={downloading} onClick={downloadInvoice}>
        <Download className="h-3.5 w-3.5" />
        {downloading ? "Preparing…" : "Download PDF"}
      </EButton>
      <EButton variant="gold" size="sm" disabled={sending} onClick={sendInvoice}>
        <Send className="h-3.5 w-3.5" />
        {sending ? "Sending…" : "Send invoice"}
      </EButton>
    </div>
  );
}
