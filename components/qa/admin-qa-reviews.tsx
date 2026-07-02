"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Pencil, Trash2, Save, X, ShieldCheck, RotateCcw } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "@/hooks/use-toast";

type Review = {
  id: string;
  score: number;
  passed: boolean;
  kind: string;
  notes: string | null;
  reviewedBy: { id: string; name: string | null; email: string } | null;
  createdAt: string;
  editedAt: string | null;
  isAuthoritative: boolean;
};

const KIND_LABEL: Record<string, string> = {
  QA: "QA inspection",
  ADMIN: "Admin score",
  AUTO: "Auto",
};

/**
 * Admin view of every QA score recorded for a job, with edit + delete. The
 * authoritative score (a real QA inspection outranks an admin/auto score) is
 * flagged. Editing/deleting recomputes the job's pass/fail + completion.
 */
export function AdminQaReviews({ jobId }: { jobId: string }) {
  const router = useRouter();
  const [reviews, setReviews] = useState<Review[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editScore, setEditScore] = useState("");
  const [editPassed, setEditPassed] = useState(false);
  const [editNotes, setEditNotes] = useState("");
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/qa/reviews?jobId=${encodeURIComponent(jobId)}`, { cache: "no-store" });
      const body = await res.json().catch(() => ({}));
      if (res.ok) setReviews(Array.isArray(body.reviews) ? body.reviews : []);
    } finally {
      setLoading(false);
    }
  }, [jobId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  function startEdit(r: Review) {
    setEditingId(r.id);
    setEditScore(String(Math.round(r.score)));
    setEditPassed(r.passed);
    setEditNotes(r.notes ?? "");
  }

  async function saveEdit(id: string) {
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/qa/reviews/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ score: Number(editScore), passed: editPassed, notes: editNotes.trim() || null }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? "Could not save.");
      toast({ title: "QA score updated" });
      setEditingId(null);
      await refresh();
      router.refresh();
    } catch (err: any) {
      toast({ title: "Update failed", description: err.message, variant: "destructive" });
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    if (!window.confirm("Delete this QA score? The job's pass/fail will be recomputed from the remaining scores.")) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/qa/reviews/${id}`, { method: "DELETE" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? "Could not delete.");
      toast({ title: "QA score deleted" });
      await refresh();
      router.refresh();
    } catch (err: any) {
      toast({ title: "Delete failed", description: err.message, variant: "destructive" });
    } finally {
      setBusy(false);
    }
  }

  async function resetQa() {
    if (
      !window.confirm(
        "Reset QA for this job? This deletes any existing QA score(s), reopens the QA inspection, and puts the job back in the QA queue for a fresh review.",
      )
    )
      return;
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/jobs/${jobId}/qa-reset`, { method: "POST" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? "Could not reset QA.");
      const parts: string[] = [];
      if (body.deletedReviews > 0) parts.push(`cleared ${body.deletedReviews} score(s)`);
      if (body.cancelledReworks > 0) parts.push(`cancelled ${body.cancelledReworks} un-started rework(s)`);
      if (body.reversedDeductions > 0) parts.push(`reversed ${body.reversedDeductions} unpaid deduction(s)`);
      toast({
        title: body.warning ? "QA reset — needs manual follow-up" : "QA reset — re-requested",
        description:
          body.warning ??
          (parts.length
            ? `${parts.join(", ")}. The job is back in the QA queue.`
            : "The job is back in the QA queue for inspection."),
        variant: body.warning ? "destructive" : undefined,
      });
      await refresh();
      router.refresh();
    } catch (err: any) {
      toast({ title: "Reset failed", description: err.message, variant: "destructive" });
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <p className="text-xs text-muted-foreground">Loading QA scores…</p>;

  return (
    <div className="mt-4 space-y-2 border-t border-border pt-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs font-semibold text-muted-foreground">
          {reviews.length > 0 ? `All QA scores (${reviews.length})` : "No QA review on this job yet"}
        </p>
        <Button size="sm" variant="outline" className="h-8" disabled={busy} onClick={() => void resetQa()}>
          <RotateCcw className="mr-1.5 h-3.5 w-3.5" />
          {reviews.length > 0 ? "Reset QA & re-request" : "Request QA inspection"}
        </Button>
      </div>
      {reviews.map((r) => (
        <div key={r.id} className="rounded-lg border border-border p-2.5 text-sm">
          {editingId === r.id ? (
            <div className="space-y-2">
              <div className="flex items-end gap-2">
                <div className="space-y-1">
                  <Label className="text-xs">Score %</Label>
                  <Input
                    type="number"
                    min={0}
                    max={100}
                    className="h-9 w-24 tabular-nums"
                    value={editScore}
                    onChange={(e) => setEditScore(e.target.value)}
                  />
                </div>
                <label className="mb-2 flex items-center gap-2 text-xs">
                  <Checkbox checked={editPassed} onCheckedChange={(v) => setEditPassed(v === true)} />
                  Passed
                </label>
              </div>
              <Input
                value={editNotes}
                onChange={(e) => setEditNotes(e.target.value)}
                placeholder="Notes (optional)"
                className="h-9"
              />
              <div className="flex gap-2">
                <Button size="sm" className="h-8" disabled={busy} onClick={() => saveEdit(r.id)}>
                  <Save className="mr-1.5 h-3.5 w-3.5" /> Save
                </Button>
                <Button size="sm" variant="ghost" className="h-8" onClick={() => setEditingId(null)}>
                  <X className="mr-1.5 h-3.5 w-3.5" /> Cancel
                </Button>
              </div>
            </div>
          ) : (
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="font-semibold tabular-nums">{r.score.toFixed(0)}%</span>
                  <Badge variant={r.passed ? "success" : "destructive"}>{r.passed ? "Pass" : "Fail"}</Badge>
                  <Badge variant="secondary">{KIND_LABEL[r.kind] ?? r.kind}</Badge>
                  {r.isAuthoritative ? (
                    <Badge variant="outline" className="gap-1">
                      <ShieldCheck className="h-3 w-3" /> Authoritative
                    </Badge>
                  ) : null}
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  {r.reviewedBy?.name || r.reviewedBy?.email || "System"} ·{" "}
                  {new Date(r.createdAt).toLocaleString()}
                  {r.editedAt ? " · edited" : ""}
                </p>
                {r.notes ? <p className="mt-1 text-xs">{r.notes}</p> : null}
              </div>
              <div className="flex shrink-0 gap-1">
                <Button size="icon" variant="ghost" className="h-8 w-8" aria-label="Edit score" onClick={() => startEdit(r)}>
                  <Pencil className="h-3.5 w-3.5" />
                </Button>
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-8 w-8 text-destructive"
                  aria-label="Delete score"
                  disabled={busy}
                  onClick={() => remove(r.id)}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
