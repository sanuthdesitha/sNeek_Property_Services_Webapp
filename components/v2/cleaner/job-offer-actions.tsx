"use client";

/**
 * Accept / decline an OFFERED job assignment. Native Estate, same endpoint as v1
 * (POST /api/cleaner/jobs/[id]/assignment-response { action }). Shown wherever an
 * offered job appears (dashboard, jobs list, job workspace).
 */
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Check, X, Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { EButton } from "@/components/v2/ui/primitives";

export function JobOfferActions({
  jobId,
  size = "sm",
  className,
  onDone,
}: {
  jobId: string;
  size?: "sm" | "md";
  className?: string;
  onDone?: () => void;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [busy, setBusy] = useState<"ACCEPT" | "DECLINE" | null>(null);

  async function respond(action: "ACCEPT" | "DECLINE") {
    setBusy(action);
    try {
      const res = await fetch(`/api/cleaner/jobs/${jobId}/assignment-response`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast({ title: "Could not respond", description: body.error, variant: "destructive" });
        return;
      }
      toast({ title: action === "ACCEPT" ? "Job accepted" : "Job declined" });
      onDone?.();
      router.refresh();
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className={`flex items-center gap-2 ${className ?? ""}`}>
      <EButton variant="gold" size={size} disabled={!!busy} onClick={() => respond("ACCEPT")}>
        {busy === "ACCEPT" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
        Accept
      </EButton>
      <EButton variant="outline" size={size} disabled={!!busy} onClick={() => respond("DECLINE")}>
        {busy === "DECLINE" ? <Loader2 className="h-4 w-4 animate-spin" /> : <X className="h-4 w-4" />}
        Decline
      </EButton>
    </div>
  );
}
