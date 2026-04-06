"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Check, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "@/hooks/use-toast";

type CleanerJobOfferActionsProps = {
  jobId: string;
  responseStatus?: string | null;
  compact?: boolean;
  onCompleted?: () => void;
};

export function CleanerJobOfferActions({
  jobId,
  responseStatus,
  compact = false,
  onCompleted,
}: CleanerJobOfferActionsProps) {
  const router = useRouter();
  const [loadingAction, setLoadingAction] = useState<"ACCEPT" | "DECLINE" | null>(null);

  if (responseStatus !== "PENDING") return null;

  async function submit(action: "ACCEPT" | "DECLINE") {
    setLoadingAction(action);
    try {
      const res = await fetch(`/api/cleaner/jobs/${jobId}/assignment-response`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(body.error ?? "Could not update the job invitation.");
      }
      toast({
        title: action === "ACCEPT" ? "Job accepted" : "Job declined",
      });
      router.refresh();
      onCompleted?.();
    } catch (error: any) {
      toast({
        title: "Invitation update failed",
        description: error?.message ?? "Could not update the job invitation.",
        variant: "destructive",
      });
    } finally {
      setLoadingAction(null);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button
        type="button"
        size={compact ? "sm" : "default"}
        className={compact ? "h-8 px-3" : undefined}
        onClick={() => void submit("ACCEPT")}
        disabled={loadingAction !== null}
      >
        <Check className="mr-1.5 h-4 w-4" />
        {loadingAction === "ACCEPT" ? "Accepting..." : "Accept"}
      </Button>
      <Button
        type="button"
        variant="outline"
        size={compact ? "sm" : "default"}
        className={compact ? "h-8 px-3" : undefined}
        onClick={() => void submit("DECLINE")}
        disabled={loadingAction !== null}
      >
        <X className="mr-1.5 h-4 w-4" />
        {loadingAction === "DECLINE" ? "Declining..." : "Decline"}
      </Button>
    </div>
  );
}
