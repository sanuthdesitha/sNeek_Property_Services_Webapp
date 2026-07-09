"use client";

/**
 * Estate job-detail assign panel — inline dispatch control on the job page.
 * Mirrors the v1 "Assigned Cleaners" + "Assignment & scheduling actions" hub:
 *   · shows current assignees (primary + offer response)
 *   · assign / reassign / add a second cleaner  (POST /api/admin/jobs/:id/assign)
 *   · resend the offer notification to the assigned cleaner(s) on one channel
 *     (POST /api/admin/notifications/dispatch/resend)
 * Read-only display of everything so dispatch stays transparent.
 */

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Mail, MessageSquare, UserPlus, Users } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { EBadge, EButton } from "@/components/v2/ui/primitives";
import {
  AssignCleanersModal,
  type AssignCleaner,
} from "@/components/v2/admin/jobs/assign-cleaners-modal";

type Assignment = {
  id: string;
  isPrimary: boolean;
  responseStatus: string;
  userId: string;
  name: string;
  email: string | null;
};

function titleCase(value: string): string {
  return value
    .toLowerCase()
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

function responseTone(status: string): "success" | "warning" | "danger" | "neutral" {
  switch (status) {
    case "ACCEPTED":
      return "success";
    case "PENDING":
      return "warning";
    case "DECLINED":
      return "danger";
    default:
      return "neutral";
  }
}

export function JobAssignPanel({
  jobId,
  jobLabel,
  jobSubLabel,
  assignments,
}: {
  jobId: string;
  jobLabel: string;
  jobSubLabel: string;
  assignments: Assignment[];
}) {
  const router = useRouter();
  const [cleaners, setCleaners] = useState<AssignCleaner[]>([]);
  const [modalOpen, setModalOpen] = useState(false);
  const [resending, setResending] = useState<"email" | "sms" | null>(null);

  useEffect(() => {
    fetch("/api/admin/users?role=CLEANER")
      .then((r) => r.json().catch(() => []))
      .then((rows) => {
        const next: AssignCleaner[] = Array.isArray(rows)
          ? rows
              .map((row: any) => ({
                id: String(row.id ?? ""),
                name: String(row.name ?? row.email ?? "").trim(),
                email: String(row.email ?? "").trim(),
              }))
              .filter((row: AssignCleaner) => row.id)
          : [];
        setCleaners(next);
      })
      .catch(() => setCleaners([]));
  }, []);

  const assignedIds = assignments.map((a) => a.userId);
  const primaryId = assignments.find((a) => a.isPrimary)?.userId ?? assignedIds[0] ?? null;
  const hasAssignees = assignments.length > 0;

  async function resend(channel: "email" | "sms") {
    setResending(channel);
    try {
      const res = await fetch("/api/admin/notifications/dispatch/resend", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobId, channel }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? "Could not resend reminder.");
      const count = Array.isArray(body.recipients) ? body.recipients.length : 0;
      toast({
        title: `${channel === "email" ? "Email" : "SMS"} reminder sent`,
        description: count > 0 ? `Delivered to ${count} recipient${count === 1 ? "" : "s"}.` : "No eligible recipients.",
      });
    } catch (err: any) {
      toast({ title: "Resend failed", description: err?.message ?? "Could not resend.", variant: "destructive" });
    } finally {
      setResending(null);
    }
  }

  return (
    <div className="space-y-3">
      {!hasAssignees ? (
        <div className="flex flex-col items-start gap-2 rounded-[var(--e-radius)] border border-dashed border-[hsl(var(--e-warning)/0.5)] bg-[hsl(var(--e-warning-soft)/0.4)] px-3 py-3">
          <p className="flex items-center gap-1.5 text-[0.8125rem] font-[550] text-[hsl(var(--e-warning))]">
            <Users className="h-3.5 w-3.5" /> No cleaners assigned yet
          </p>
          <EButton variant="gold" size="sm" onClick={() => setModalOpen(true)}>
            <UserPlus className="mr-1.5 h-3.5 w-3.5" /> Assign cleaner
          </EButton>
        </div>
      ) : (
        <ul className="space-y-2">
          {assignments.map((a) => (
            <li key={a.id} className="flex flex-wrap items-center gap-2 text-[0.8125rem]">
              {a.isPrimary ? <EBadge tone="primary" soft>Primary</EBadge> : null}
              <span className="font-[550]">{a.name}</span>
              <EBadge tone={responseTone(a.responseStatus)} soft>{titleCase(a.responseStatus)}</EBadge>
            </li>
          ))}
        </ul>
      )}

      {hasAssignees ? (
        <div className="flex flex-wrap items-center gap-2 border-t border-[hsl(var(--e-border))] pt-3">
          <EButton variant="outline" size="sm" onClick={() => setModalOpen(true)}>
            <UserPlus className="mr-1.5 h-3.5 w-3.5" /> Reassign / add cleaner
          </EButton>
          <EButton variant="ghost" size="sm" onClick={() => resend("email")} disabled={resending !== null}>
            <Mail className="mr-1.5 h-3.5 w-3.5" /> {resending === "email" ? "Sending…" : "Resend email"}
          </EButton>
          <EButton variant="ghost" size="sm" onClick={() => resend("sms")} disabled={resending !== null}>
            <MessageSquare className="mr-1.5 h-3.5 w-3.5" /> {resending === "sms" ? "Sending…" : "Resend SMS"}
          </EButton>
        </div>
      ) : null}

      <AssignCleanersModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        jobId={jobId}
        jobLabel={jobLabel}
        jobSubLabel={jobSubLabel}
        cleaners={cleaners}
        initialAssignedIds={assignedIds}
        initialPrimaryId={primaryId}
        onAssigned={() => router.refresh()}
      />
    </div>
  );
}
