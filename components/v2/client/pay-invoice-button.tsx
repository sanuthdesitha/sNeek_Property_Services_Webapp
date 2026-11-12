"use client";

/**
 * Estate Pay-now control. Same flow as the legacy PayNowButton:
 *   POST /api/client/invoices/[id]/payment-link → { url } → Stripe redirect.
 */
import { useState } from "react";
import { CreditCard, Loader2 } from "lucide-react";
import { EButton } from "@/components/v2/ui/primitives";

export function PayInvoiceButton({
  invoiceId,
  label = "Pay now",
  wide = false,
}: {
  invoiceId: string;
  /** Button text, e.g. "Pay $1,870.00 now" (Money tab). */
  label?: string;
  /** Full-width primary action (the Money tab's bottom bar). */
  wide?: boolean;
}) {
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
    <div className={wide ? "flex w-full flex-col gap-1" : "flex flex-col items-end gap-1"}>
      <EButton variant="gold" size={wide ? "md" : "sm"} onClick={handlePayNow} disabled={loading} className={wide ? "min-h-11 w-full justify-center" : undefined}>
        {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CreditCard className="h-3.5 w-3.5" />}
        {loading ? "Opening the secure payment page…" : label}
      </EButton>
      {error ? (
        <span className="text-[0.6875rem] text-[hsl(var(--e-danger))]" role="status">
          {error}
        </span>
      ) : null}
    </div>
  );
}
