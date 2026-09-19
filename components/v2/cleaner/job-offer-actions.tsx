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
import { useOnlineAction } from "@/hooks/use-online-action";
import { useSession } from "next-auth/react";

type OfferProps = { jobId: string; size?: "sm" | "md"; className?: string; onDone?: () => void };
export function JobOfferActions(props: OfferProps) {
  const { data: session, status } = useSession();
  if (status !== "authenticated" || !session?.user?.id) return null;
  const scope = JSON.stringify([session.impersonation?.actorId ?? session.user.id, session.user.id, props.jobId]);
  return <ScopedJobOfferActions key={scope} {...props} scope={scope}/>;
}
function ScopedJobOfferActions({
  jobId,
  size = "sm",
  className,
  onDone,
  scope,
}: {
  jobId: string;
  size?: "sm" | "md";
  className?: string;
  onDone?: () => void;
  scope: string;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [busy, setBusy] = useState<"ACCEPT" | "DECLINE" | null>(null);
  const actionGuard = useOnlineAction(`offer:${scope}`);
  const [resolved, setResolved] = useState(false);
  async function draftIdentity() {
    const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(["cleaner-draft-identity-v1", ...JSON.parse(scope)])));
    return Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, "0")).join("");
  }

  async function respond(action: "ACCEPT" | "DECLINE") {
    if (resolved) return;
    try { actionGuard.begin(`Offer ${action.toLowerCase()}`); } catch (error: any) {
      toast({ title: "Could not respond", description: error.message, variant: "destructive" }); return;
    }
    let actionError: unknown;
    setBusy(action);
    try {
      await actionGuard.post(`/api/cleaner/jobs/${jobId}/assignment-response`, { action }, await draftIdentity());
      setResolved(true);
      toast({ title: action === "ACCEPT" ? "Job accepted" : "Job declined" });
      onDone?.();
      router.refresh();
    } catch (error: any) {
      actionError = error;
      toast({ title: "Could not confirm response", description: error.message, variant: "destructive" });
    } finally {
      actionGuard.finish(actionError);
      setBusy(null);
    }
  }

  async function checkStatus() {
    try {
      await actionGuard.reconcile(async receipt => {
        if (receipt?.state === "COMMITTED" && ["DECLINED", "TRANSFERRED"].includes(String(receipt.result.body.assignmentStatus))) {
          setResolved(true); onDone?.(); router.refresh(); return;
        }
        const expectedIdentity = await draftIdentity();
        const response = await fetch(`/api/jobs/${jobId}/form`, { cache: "no-store" });
        const data = await response.json();
        if (!response.ok || data?.draftIdentity !== expectedIdentity || data?.job?.id !== jobId || !["PENDING", "ACCEPTED", "DECLINED", "TRANSFERRED"].includes(data?.assignmentState?.responseStatus)) {
          throw new Error("Assignment status could not be verified. Refresh the job list before taking another action.");
        }
        const stillOffered = data.assignmentState.responseStatus === "PENDING";
        setResolved(!stillOffered);
        toast({ title: stillOffered ? "Job is still offered. You can choose a response." : "Assignment response is already recorded." });
        if (!stillOffered) { onDone?.(); router.refresh(); }
      });
    } catch (error: any) { toast({ title: "Status needs checking", description: error.message, variant: "destructive" }); }
  }

  return (
    <div className={`flex flex-wrap items-center gap-2 ${className ?? ""}`}>
      <EButton variant="gold" size={size} disabled={!!busy || actionGuard.blocked || resolved} onClick={() => respond("ACCEPT")}>
        {busy === "ACCEPT" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
        Accept
      </EButton>
      <EButton variant="outline" size={size} disabled={!!busy || actionGuard.blocked || resolved} onClick={() => respond("DECLINE")}>
        {busy === "DECLINE" ? <Loader2 className="h-4 w-4 animate-spin" /> : <X className="h-4 w-4" />}
        Decline
      </EButton>
      {!actionGuard.online ? <span role="status">Reconnect to respond. Your response will not be queued.</span> : null}
      {actionGuard.uncertain ? <><span role="status">The response may have been saved.</span><EButton variant="outline" size={size}
        disabled={!actionGuard.online || actionGuard.checking} onClick={() => void checkStatus()}>Check assignment status</EButton></> : null}
    </div>
  );
}
