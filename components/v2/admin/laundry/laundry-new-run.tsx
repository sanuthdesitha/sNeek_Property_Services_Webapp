"use client";

/**
 * ESTATE laundry "New run" — v2-native wrapper over the v1 generate-week flow.
 * Reuses POST /api/admin/laundry/generate-week: first without `approve` to build
 * a draft plan of this week's turnover pickups/drop-offs, then (on confirm) with
 * `approve: true` + the draft items to write the tasks. No new data layer.
 */
import * as React from "react";
import { format, startOfWeek } from "date-fns";
import { CalendarPlus, Sparkles } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { EBadge, EButton } from "@/components/v2/ui/primitives";
import { EModal } from "@/components/v2/admin/estate-kit";
import { statusLabel, statusTone } from "./laundry-shared";

type DraftItem = {
  jobId: string;
  propertyId: string;
  propertyName: string;
  suburb?: string;
  cleanDate: string;
  pickupDate: string;
  dropoffDate: string;
  status: string;
  scenario?: string;
  operation?: "CREATE" | "UPDATE";
};

export function LaundryNewRun({ onApplied }: { onApplied: () => void }) {
  const weekStart = React.useMemo(() => startOfWeek(new Date(), { weekStartsOn: 1 }), []);
  const [open, setOpen] = React.useState(false);
  const [generating, setGenerating] = React.useState(false);
  const [approving, setApproving] = React.useState(false);
  const [draft, setDraft] = React.useState<DraftItem[]>([]);

  async function generate() {
    setGenerating(true);
    try {
      const res = await fetch("/api/admin/laundry/generate-week", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ weekStart: weekStart.toISOString() }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast({ title: "Generation failed", description: body.error ?? "Could not generate the plan.", variant: "destructive" });
        return;
      }
      const items: DraftItem[] = Array.isArray(body?.draft) ? body.draft : [];
      setDraft(items);
      setOpen(true);
      if (items.length === 0) {
        toast({ title: "No new plan items", description: "There are no new turnover jobs to schedule for this week." });
      }
    } finally {
      setGenerating(false);
    }
  }

  async function approve() {
    if (draft.length === 0) return;
    setApproving(true);
    try {
      const res = await fetch("/api/admin/laundry/generate-week", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ weekStart: weekStart.toISOString(), approve: true, items: draft }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast({ title: "Approval failed", description: body.error ?? "Could not approve the plan.", variant: "destructive" });
        return;
      }
      toast({
        title: "Laundry plan approved",
        description: `${body.appliedCount ?? draft.length} task${(body.appliedCount ?? draft.length) === 1 ? "" : "s"} added to the calendar.`,
      });
      setOpen(false);
      setDraft([]);
      onApplied();
    } finally {
      setApproving(false);
    }
  }

  return (
    <>
      <EButton variant="gold" size="sm" onClick={() => void generate()} disabled={generating}>
        <CalendarPlus className="h-3.5 w-3.5" /> {generating ? "Building…" : "New run"}
      </EButton>

      <EModal
        open={open}
        onClose={() => setOpen(false)}
        eyebrow={`Week of ${format(weekStart, "d MMM yyyy")}`}
        title="New laundry run"
        size="xl"
      >
        <div className="space-y-4">
          <p className="inline-flex items-center gap-2 text-[0.875rem] text-[hsl(var(--e-text-secondary))]">
            <Sparkles className="h-4 w-4 text-[hsl(var(--e-gold-ink))]" />
            Draft plan generated from this week&apos;s turnover jobs. Review, then approve to add the tasks.
          </p>

          {draft.length === 0 ? (
            <p className="py-8 text-center text-[0.875rem] text-[hsl(var(--e-muted-foreground))]">
              No new turnover jobs need a laundry run this week.
            </p>
          ) : (
            <ul className="space-y-2">
              {draft.map((item) => (
                <li
                  key={`${item.jobId}-${item.pickupDate}`}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface-raised))] px-3 py-2"
                >
                  <div className="min-w-0">
                    <p className="truncate text-[0.875rem] font-[550]">
                      {item.propertyName}
                      {item.suburb ? <span className="font-normal text-[hsl(var(--e-muted-foreground))]">, {item.suburb}</span> : null}
                    </p>
                    <p className="e-tnum text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
                      Pickup {format(new Date(item.pickupDate), "EEE d MMM")} · Drop-off {format(new Date(item.dropoffDate), "EEE d MMM")}
                    </p>
                  </div>
                  <div className="flex items-center gap-1.5">
                    {item.operation ? (
                      <EBadge tone={item.operation === "UPDATE" ? "warning" : "neutral"} soft>
                        {item.operation === "UPDATE" ? "Update" : "New"}
                      </EBadge>
                    ) : null}
                    <EBadge tone={statusTone(item.status)} soft>
                      {statusLabel(item.status)}
                    </EBadge>
                  </div>
                </li>
              ))}
            </ul>
          )}

          <div className="flex justify-end gap-2 border-t border-[hsl(var(--e-border))] pt-4">
            <EButton variant="outline" size="sm" onClick={() => setOpen(false)} disabled={approving}>
              Cancel
            </EButton>
            <EButton variant="gold" size="sm" onClick={() => void approve()} disabled={approving || draft.length === 0}>
              {approving ? "Approving…" : `Approve ${draft.length || ""} task${draft.length === 1 ? "" : "s"}`.trim()}
            </EButton>
          </div>
        </div>
      </EModal>
    </>
  );
}
