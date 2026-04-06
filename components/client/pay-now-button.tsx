"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "@/hooks/use-toast";

export function PayNowButton({ invoiceId }: { invoiceId: string }) {
  const [loading, setLoading] = useState(false);

  async function handlePayNow() {
    setLoading(true);
    try {
      const response = await fetch(`/api/client/invoices/${invoiceId}/payment-link`, {
        method: "POST",
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok || typeof body?.url !== "string") {
        throw new Error(body?.error ?? "Could not open payment link.");
      }
      window.location.assign(body.url);
    } catch (error: any) {
      toast({
        title: "Payment link failed",
        description: error?.message ?? "Could not create payment link.",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  }

  return (
    <Button size="sm" onClick={handlePayNow} disabled={loading}>
      {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
      Pay now
    </Button>
  );
}
