"use client";

/**
 * Runs a cleaner-invoice action from the list or the review page: Approve and
 * Push to Xero go straight to their endpoints; everything else opens its
 * dialog. The server's refusal is shown as given.
 */
import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import { useToast } from "@/hooks/use-toast";
import type { CleanerDialog } from "./cleaner-invoice-dialogs";
import type { CleanerRow, CleanerUiAction } from "./cleaner-invoice-model";

export function useCleanerInvoiceActions(onDone: () => void, reviewHref: (row: CleanerRow) => string) {
  const { toast } = useToast();
  const router = useRouter();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [dialog, setDialog] = useState<CleanerDialog>(null);

  const direct = useCallback(
    async (row: CleanerRow, request: { url: string; init: RequestInit }, success: string, failure: string) => {
      setBusyId(row.id);
      try {
        const response = await fetch(request.url, request.init);
        const body = (await response.json().catch(() => ({}))) as { error?: string };
        if (!response.ok) {
          toast({ title: failure, description: body.error ?? `Request failed (${response.status}).`, variant: "destructive" });
          return;
        }
        toast({ title: success });
        onDone();
      } catch {
        toast({ title: failure, description: "Could not reach the server.", variant: "destructive" });
      } finally {
        setBusyId(null);
      }
    },
    [onDone, toast],
  );

  const onAction = useCallback(
    (action: CleanerUiAction, row: CleanerRow) => {
      switch (action) {
        case "approve":
          void direct(row, { url: `/api/admin/cleaner-invoices/${row.id}`, init: { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status: "APPROVED" }) } }, "Invoice approved", "Could not approve");
          return;
        case "push-xero":
          void direct(row, { url: `/api/admin/cleaner-invoices/${row.id}/xero-push`, init: { method: "POST" } }, "Pushed to Xero", "Xero push failed");
          return;
        case "view":
          router.push(reviewHref(row));
          return;
        case "pdf":
          window.open(`/api/admin/cleaner-invoices/${row.id}/pdf?inline=1`, "_blank", "noopener");
          return;
        default:
          setDialog({ kind: action, row });
      }
    },
    [direct, reviewHref, router],
  );

  return { busyId, dialog, setDialog, onAction };
}
