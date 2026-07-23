"use client";

/**
 * Estate job-detail QA assign panel — shows the job's current QA assignment
 * (inspector + status) and lets admin/ops assign or reassign the inspection.
 * Wire contract:
 *   · assign   → POST  /api/admin/qa/assignments        { jobIds: [jobId], assignedToId }
 *   · reassign → PATCH /api/admin/qa/assignments/[id]   { assignedToId }
 * Mirrors how JobAssignPanel is wired (server-loaded props + router.refresh()).
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ShieldCheck } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { EBadge, EButton } from "@/components/v2/ui/primitives";
import { ESelect } from "@/components/v2/admin/estate-kit";

export type QaAssignInspector = { id: string; name: string | null; email: string; role: string };

export type QaAssignCurrent = {
  id: string;
  status: string;
  assignedToId: string | null;
  assignedToName: string | null;
} | null;

function titleCase(value: string): string {
  return value
    .toLowerCase()
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

function statusTone(status: string): "success" | "info" | "warning" | "neutral" {
  switch (status) {
    case "COMPLETED":
      return "success";
    case "IN_PROGRESS":
      return "info";
    case "OPEN":
    case "ASSIGNED":
      return "warning";
    default:
      return "neutral";
  }
}

export function QaAssignPanel({
  jobId,
  current,
  inspectors,
}: {
  jobId: string;
  /** The job's current ACTIVE QA assignment (not cancelled/completed), if any. */
  current: QaAssignCurrent;
  /** Eligible users: active QA inspectors + ops managers. */
  inspectors: QaAssignInspector[];
}) {
  const router = useRouter();
  const [assignedToId, setAssignedToId] = useState(current?.assignedToId ?? "");
  const [saving, setSaving] = useState(false);

  async function assign() {
    if (!assignedToId) {
      toast({ title: "Pick an inspector first.", variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      const res = current
        ? await fetch(`/api/admin/qa/assignments/${current.id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ assignedToId }),
          })
        : await fetch("/api/admin/qa/assignments", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ jobIds: [jobId], assignedToId }),
          });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body?.error ?? "Could not assign the QA inspection.");
      toast({ title: current ? "QA inspection reassigned" : "QA inspection assigned" });
      router.refresh();
    } catch (err: any) {
      toast({
        title: "Assign QA failed",
        description: err?.message ?? "Please retry.",
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2 text-[0.8125rem]">
        <ShieldCheck className="h-4 w-4 text-[hsl(var(--e-accent-portal))]" />
        {current ? (
          <>
            <span className="font-[550]">{current.assignedToName ?? "Unassigned (open pool)"}</span>
            <EBadge tone={statusTone(current.status)} soft>
              {titleCase(current.status)}
            </EBadge>
          </>
        ) : (
          <span className="text-[hsl(var(--e-muted-foreground))]">No QA assignment yet.</span>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <ESelect
          value={assignedToId}
          onChange={(e) => setAssignedToId(e.target.value)}
          className="min-w-[220px] flex-1"
        >
          <option value="">Select inspector…</option>
          {inspectors.map((u) => (
            <option key={u.id} value={u.id}>
              {(u.name || u.email) + (u.role === "OPS_MANAGER" ? " (Ops)" : "")}
            </option>
          ))}
        </ESelect>
        <EButton variant="primary" size="sm" disabled={saving || !assignedToId} onClick={() => void assign()}>
          {saving ? "Saving…" : current ? "Reassign QA" : "Assign QA"}
        </EButton>
      </div>
    </div>
  );
}
