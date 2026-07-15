"use client";

/**
 * Cleaner-facing "Coaching & feedback" card (Phase 7b). Self-fetches the
 * cleaner's own coaching records from GET /api/cleaner/coaching and renders
 * nothing when there are none. OPEN records carry an Acknowledge button that
 * POSTs to /[id]/acknowledge and refreshes. Estate v2 styling.
 */
import { useCallback, useEffect, useState } from "react";
import { format, parseISO } from "date-fns";
import { GraduationCap } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { EBadge, EButton, ECard, ECardBody, EEyebrow } from "@/components/v2/ui/primitives";

type Record_ = {
  id: string;
  type: string;
  status: string;
  reason: string;
  retrainingRequired: boolean;
  reviewDate: string | null;
  createdAt: string;
  createdByName: string;
};

function fmt(value: string | null | undefined) {
  if (!value) return "—";
  try {
    return format(parseISO(value), "dd MMM yyyy");
  } catch {
    return String(value);
  }
}

function titleCase(value?: string | null) {
  if (!value) return "—";
  return value
    .toLowerCase()
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

function typeTone(type?: string): "neutral" | "warning" | "danger" {
  return type === "MANAGEMENT_REVIEW" ? "danger" : type === "WARNING" ? "warning" : "neutral";
}

export function CleanerCoachingCard() {
  const [records, setRecords] = useState<Record_[] | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/cleaner/coaching", { cache: "no-store" });
      const body = await res.json().catch(() => null);
      if (res.ok && body) setRecords(body.records ?? []);
      else setRecords([]);
    } catch {
      setRecords([]);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function acknowledge(id: string) {
    setBusyId(id);
    try {
      const res = await fetch(`/api/cleaner/coaching/${id}/acknowledge`, { method: "POST" });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error ?? "Could not acknowledge");
      toast({ title: "Acknowledged" });
      await load();
    } catch (err: any) {
      toast({ title: "Failed", description: err?.message ?? "Could not acknowledge", variant: "destructive" });
    } finally {
      setBusyId(null);
    }
  }

  // Show recent + all open records; hide entirely when there is nothing.
  if (!records || records.length === 0) return null;
  const visible = records.filter((r) => r.status === "OPEN").length
    ? records.filter((r) => r.status === "OPEN" || r.status === "ACKNOWLEDGED").slice(0, 5)
    : records.slice(0, 3);
  if (visible.length === 0) return null;

  return (
    <section className="space-y-3">
      <span className="e-eyebrow flex items-center gap-1.5">
        <GraduationCap className="h-3.5 w-3.5" /> COACHING &amp; FEEDBACK
      </span>
      {visible.map((r) => (
        <ECard key={r.id} className="border-l-[3px] border-l-[hsl(var(--e-warning))]">
          <ECardBody className="space-y-2 pt-6">
            <div className="flex flex-wrap items-center gap-2">
              <EBadge tone={typeTone(r.type)} soft>
                {titleCase(r.type)}
              </EBadge>
              {r.status === "OPEN" ? (
                <EBadge tone="warning" soft>
                  Needs acknowledgement
                </EBadge>
              ) : (
                <EBadge tone="info" soft>
                  {titleCase(r.status)}
                </EBadge>
              )}
              {r.retrainingRequired ? <EBadge tone="warning" soft>Retraining</EBadge> : null}
              <span className="ml-auto text-[0.75rem] text-[hsl(var(--e-text-faint))]">{fmt(r.createdAt)}</span>
            </div>
            <p className="whitespace-pre-wrap text-[0.875rem] text-[hsl(var(--e-text-secondary))]">{r.reason}</p>
            <p className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
              From {r.createdByName}
              {r.reviewDate ? ` · Review ${fmt(r.reviewDate)}` : ""}
            </p>
            {r.status === "OPEN" ? (
              <div>
                <EButton variant="gold" size="sm" onClick={() => acknowledge(r.id)} disabled={busyId === r.id}>
                  {busyId === r.id ? "Saving…" : "Acknowledge"}
                </EButton>
              </div>
            ) : null}
          </ECardBody>
        </ECard>
      ))}
    </section>
  );
}
