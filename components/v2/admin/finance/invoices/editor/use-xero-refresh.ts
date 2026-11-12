"use client";

/**
 * "Refresh from Xero" for the invoice open in the editor: one request to
 * POST /api/admin/invoices/xero-sync, the server's own words for the outcome,
 * then a reload so the card, stage bar and payments show what is now stored.
 * State resets when the editor opens a different invoice.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import {
  XERO_SYNC_OUTCOME_LABEL,
  type XeroSyncRunSummary,
} from "@/lib/billing/client-invoice-xero-sync-types";
import type { XeroRefreshState } from "./editor-panels";

export function useXeroRefresh(invoiceId: string, reload: () => Promise<boolean>) {
  const [state, setState] = useState<XeroRefreshState>({ status: "idle" });
  const current = useRef(invoiceId);
  useEffect(() => {
    current.current = invoiceId;
    setState({ status: "idle" });
  }, [invoiceId]);

  const refresh = useCallback(async () => {
    const asked = invoiceId;
    setState({ status: "running" });
    try {
      const response = await fetch("/api/admin/invoices/xero-sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: [asked] }),
      });
      const body = (await response.json().catch(() => null)) as (XeroSyncRunSummary & { error?: string }) | null;
      if (current.current !== asked) return;
      const result = body?.results?.[0];
      if (!response.ok || !result) {
        setState({ status: "done", ok: false, message: body?.error ?? "Xero could not be checked. Nothing was changed." });
        return;
      }
      const label = XERO_SYNC_OUTCOME_LABEL[result.outcome];
      const payments = result.paymentsRecorded ? ` ${result.paymentsRecorded} payment${result.paymentsRecorded === 1 ? "" : "s"} recorded.` : "";
      setState({
        status: "done",
        ok: result.outcome !== "unknown" && result.outcome !== "needs-review",
        message: `${label}.${payments}${result.reason ? ` ${result.reason}` : ""}`,
      });
      await reload();
    } catch {
      if (current.current === asked) setState({ status: "done", ok: false, message: "Could not reach the server. Nothing is reported as checked." });
    }
  }, [invoiceId, reload]);

  return { state, refresh };
}
