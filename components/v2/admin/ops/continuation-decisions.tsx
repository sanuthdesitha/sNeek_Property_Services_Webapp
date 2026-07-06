"use client";

/**
 * ESTATE continuation approvals — approve/decline cleaner continuation
 * requests inline. Same endpoint as the legacy console:
 * PATCH /api/admin/job-continuations/[id] { decision: "APPROVE" | "REJECT" }.
 */

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { format } from "date-fns";
import { Check, X } from "lucide-react";
import { EBadge, EButton } from "@/components/v2/ui/primitives";
import { toast } from "@/hooks/use-toast";

export type ContinuationRow = {
  id: string;
  jobId: string;
  reason: string;
  requestedAt: string;
  jobNumber?: number | string | null;
  propertyName?: string | null;
  suburb?: string | null;
};

export function ContinuationDecisions({ requests }: { requests: ContinuationRow[] }) {
  const router = useRouter();
  const [rows, setRows] = useState(requests);
  const [busyId, setBusyId] = useState<string | null>(null);

  async function decide(id: string, decision: "APPROVE" | "REJECT") {
    setBusyId(id);
    try {
      const res = await fetch(`/api/admin/job-continuations/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decision }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? "Could not record the decision.");
      setRows((current) => current.filter((row) => row.id !== id));
      toast({ title: decision === "APPROVE" ? "Continuation approved" : "Continuation declined" });
      router.refresh();
    } catch (err: any) {
      toast({ title: "Decision failed", description: err.message ?? "Try again.", variant: "destructive" });
    } finally {
      setBusyId(null);
    }
  }

  if (rows.length === 0) {
    return (
      <p className="rounded-[var(--e-radius)] border border-dashed border-[hsl(var(--e-border))] px-3 py-6 text-center text-[0.75rem] text-[hsl(var(--e-text-faint))]">
        No continuation requests waiting on a decision.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      {rows.map((request) => (
        <div
          key={request.id}
          className="rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] px-3 py-3"
        >
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <Link
                href={`/v2/admin/jobs/${request.jobId}`}
                className="block truncate text-[0.8125rem] font-[550] hover:underline"
              >
                {request.propertyName ?? "Continuation request"}
              </Link>
              <p className="truncate text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
                {request.suburb ? `${request.suburb} · ` : ""}
                {request.jobNumber ? `#${request.jobNumber} · ` : ""}
                Requested {format(new Date(request.requestedAt), "dd MMM HH:mm")}
              </p>
            </div>
            <EBadge tone="danger" soft>Pending</EBadge>
          </div>
          {request.reason ? (
            <p className="mt-2 text-[0.75rem] text-[hsl(var(--e-text-secondary))]">{request.reason}</p>
          ) : null}
          <div className="mt-3 flex gap-2">
            <EButton
              variant="primary"
              size="sm"
              disabled={busyId === request.id}
              onClick={() => void decide(request.id, "APPROVE")}
            >
              <Check className="h-3.5 w-3.5" /> Approve
            </EButton>
            <EButton
              variant="outline"
              size="sm"
              disabled={busyId === request.id}
              onClick={() => void decide(request.id, "REJECT")}
            >
              <X className="h-3.5 w-3.5" /> Decline
            </EButton>
            <EButton asChild variant="ghost" size="sm">
              <Link href={`/v2/admin/jobs/${request.jobId}`}>Open job</Link>
            </EButton>
          </div>
        </div>
      ))}
    </div>
  );
}
