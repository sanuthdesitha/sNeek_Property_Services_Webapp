"use client";

/**
 * Estate Pay-now control. Same flow as the legacy PayNowButton:
 *   POST /api/client/invoices/[id]/payment-link → { url } → Stripe redirect.
 */
import { useState } from "react";
import { CreditCard, Loader2 } from "lucide-react";
import { EButton } from "@/components/v2/ui/primitives";

export function PayInvoiceButton({ invoiceId }: { invoiceId: string }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handlePayNow() {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/client/invoices/${invoiceId}/payment-link`, {
        method: "POST",
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok || typeof body?.url !== "string") {
        throw new Error(body?.error ?? "Could not open the payment link.");
      }
      window.location.assign(body.url);
    } catch (err: any) {
      setError(err?.message ?? "Could not create the payment link.");
      setLoading(false);
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <EButton variant="gold" size="sm" onClick={handlePayNow} disabled={loading}>
        {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CreditCard className="h-3.5 w-3.5" />}
        {loading ? "Opening…" : "Pay now"}
      </EButton>
      {error ? (
        <span className="text-[0.6875rem] text-[hsl(var(--e-danger))]" role="status">
          {error}
        </span>
      ) : null}
    </div>
  );
}
