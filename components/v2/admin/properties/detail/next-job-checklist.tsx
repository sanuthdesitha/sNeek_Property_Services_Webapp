"use client";

/**
 * "Next-job checklist": one-off tasks that attach to this property's next
 * upcoming job (GET/POST/DELETE /api/admin/properties/:id/pending-tasks).
 * Moved here unchanged in rule: new tasks default to photo proof, the
 * request id is kept across a failed attempt so a retry cannot create a
 * second task, and typed work is kept after a failure.
 */
import { useCallback, useEffect, useState } from "react";
import { Camera, FileText } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { EBadge, EButton, ECard } from "@/components/v2/ui/primitives";
import { EConfirmButton, EField, EInput, EModal, ESwitch, ETextarea } from "@/components/v2/admin/estate-kit";
import { sydneyRelativeDayLabel } from "@/lib/jobs/date-grouping";
import { CardHead, Muted } from "./section-card";

export type PendingTask = { id: string; title: string; description?: string | null; requiresPhoto?: boolean; requiresNote?: boolean };

const EMPTY_FORM = { title: "", description: "", requiresPhoto: true, requiresNote: false, allowNotApplicable: false };

export function usePendingTasks(propertyId: string) {
  const [tasks, setTasks] = useState<PendingTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    fetch(`/api/admin/properties/${encodeURIComponent(propertyId)}/pending-tasks`, { signal: controller.signal })
      .then(async (response) => {
        const body: unknown = await response.json().catch(() => []);
        if (controller.signal.aborted) return;
        setTasks(Array.isArray(body) ? (body as PendingTask[]) : []);
      })
      .catch(() => undefined)
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [propertyId, revision]);
  const reload = useCallback(() => setRevision((value) => value + 1), []);
  return { tasks, loading, reload };
}

export function NextJobChecklist({
  propertyId,
  pending,
  nextJobDayKey,
  compact = false,
}: {
  propertyId: string;
  pending: ReturnType<typeof usePendingTasks>;
  nextJobDayKey?: string | null;
  compact?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [requestId, setRequestId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [cancellingId, setCancellingId] = useState<string | null>(null);

  async function addTask() {
    if (!form.title.trim()) return;
    setSaving(true);
    const id = requestId ?? crypto.randomUUID();
    setRequestId(id);
    try {
      const response = await fetch(`/api/admin/properties/${propertyId}/pending-tasks`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          requestId: id,
          allowNotApplicable: form.allowNotApplicable,
          title: form.title.trim(),
          description: form.description.trim() || undefined,
          requiresPhoto: form.requiresPhoto,
          requiresNote: form.requiresNote,
        }),
      });
      if (!response.ok) {
        const error = (await response.json().catch(() => ({}))) as { error?: string };
        toast({ title: "Failed to add task", description: error.error ?? "Unknown error", variant: "destructive" });
        return;
      }
      setRequestId(null);
      setForm(EMPTY_FORM);
      setOpen(false);
      pending.reload();
      toast({ title: "Task added", description: "Will attach to the next upcoming job for this property." });
    } finally {
      setSaving(false);
    }
  }

  async function cancelTask(taskId: string) {
    setCancellingId(taskId);
    try {
      const response = await fetch(`/api/admin/properties/${propertyId}/pending-tasks/${taskId}`, { method: "DELETE" });
      if (!response.ok) {
        const error = (await response.json().catch(() => ({}))) as { error?: string };
        toast({ title: "Failed to cancel task", description: error.error ?? "Unknown error", variant: "destructive" });
        return;
      }
      pending.reload();
      toast({ title: "Task cancelled" });
    } finally {
      setCancellingId(null);
    }
  }

  return (
    <ECard className={"flex min-w-0 flex-col gap-2 p-4 " + (compact ? "flex-1" : "")}>
      <CardHead title="Next-job checklist" action={<EButton size="sm" variant="outline" onClick={() => setOpen(true)}>Add task</EButton>} />
      {pending.loading ? (
        <Muted>Loading tasks…</Muted>
      ) : pending.tasks.length === 0 ? (
        <Muted>Nothing queued. Add a one-off task and it will attach to this property&apos;s next upcoming job.</Muted>
      ) : (
        <ul className="divide-y divide-[hsl(var(--e-border))]">
          {pending.tasks.map((task) => (
            <li key={task.id} className="flex items-start justify-between gap-3 py-2">
              <div className="min-w-0 text-[0.8125rem]">
                <b className="font-[600]">{task.title}</b>{" "}
                {task.requiresPhoto ? <EBadge tone="info" soft><Camera className="h-2.5 w-2.5" /> Photo</EBadge> : null}{" "}
                {task.requiresNote ? <EBadge tone="neutral" soft><FileText className="h-2.5 w-2.5" /> Note</EBadge> : null}
                {task.description ? <p className="mt-0.5 text-[hsl(var(--e-muted-foreground))]">{task.description}</p> : null}
              </div>
              <EConfirmButton ariaLabel="Cancel pending task" confirmLabel="Cancel it?" disabled={cancellingId === task.id} onConfirm={() => void cancelTask(task.id)}>
                {cancellingId === task.id ? "Cancelling…" : "Cancel"}
              </EConfirmButton>
            </li>
          ))}
        </ul>
      )}
      <Muted>
        <span className="text-[0.75rem]">
          Attaches to the next upcoming job{nextJobDayKey ? ` (${sydneyRelativeDayLabel(nextJobDayKey)})` : ""}.
        </span>
      </Muted>

      <EModal open={open} onClose={() => setOpen(false)} title="Add checklist task" eyebrow="Next job">
        <fieldset disabled={saving} className="space-y-4">
          <EField label="Title">
            <EInput value={form.title} onChange={(e) => setForm((p) => ({ ...p, title: e.target.value }))} placeholder="e.g. Replace batteries in smoke alarm" />
          </EField>
          <EField label="Description">
            <ETextarea value={form.description} onChange={(e) => setForm((p) => ({ ...p, description: e.target.value }))} />
          </EField>
          <div className="flex flex-wrap gap-4">
            <ESwitch checked={form.allowNotApplicable} onCheckedChange={(v) => setForm((p) => ({ ...p, allowNotApplicable: v }))} label="Allow not applicable (reason + photo; no carry-forward)" />
            <ESwitch checked={form.requiresPhoto} onCheckedChange={(v) => setForm((p) => ({ ...p, requiresPhoto: v }))} label="Requires photo" />
            <ESwitch checked={form.requiresNote} onCheckedChange={(v) => setForm((p) => ({ ...p, requiresNote: v }))} label="Requires note" />
          </div>
        </fieldset>
        <div className="mt-4 flex justify-end gap-2">
          <EButton variant="outline" size="sm" onClick={() => setOpen(false)}>Cancel</EButton>
          <EButton variant="gold" size="sm" onClick={addTask} disabled={saving || !form.title.trim()}>{saving ? "Adding…" : "Add task"}</EButton>
        </div>
      </EModal>
    </ECard>
  );
}
