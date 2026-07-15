"use client";

/**
 * v1 cleaner-facing "Coaching & feedback" card (Phase 7b). Self-fetches the
 * cleaner's own coaching records from GET /api/cleaner/coaching and renders
 * nothing when there are none. OPEN records carry an Acknowledge button.
 */
import { useCallback, useEffect, useState } from "react";
import { format, parseISO } from "date-fns";
import { GraduationCap } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

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

function typeVariant(type?: string): any {
  return type === "MANAGEMENT_REVIEW" ? "destructive" : type === "WARNING" ? "warning" : "secondary";
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

  if (!records || records.length === 0) return null;
  const visible = records.filter((r) => r.status === "OPEN").length
    ? records.filter((r) => r.status === "OPEN" || r.status === "ACKNOWLEDGED").slice(0, 5)
    : records.slice(0, 3);
  if (visible.length === 0) return null;

  return (
    <Card className="border-warning/40">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-lg">
          <GraduationCap className="h-5 w-5 text-warning" />
          Coaching &amp; Feedback
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {visible.map((r) => (
          <div key={r.id} className="rounded-xl border border-border bg-surface p-3">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant={typeVariant(r.type)}>{titleCase(r.type)}</Badge>
              {r.status === "OPEN" ? (
                <Badge variant="warning">Needs acknowledgement</Badge>
              ) : (
                <Badge variant="secondary">{titleCase(r.status)}</Badge>
              )}
              {r.retrainingRequired ? <Badge variant="warning">Retraining</Badge> : null}
              <span className="ml-auto text-xs text-muted-foreground">{fmt(r.createdAt)}</span>
            </div>
            <p className="mt-2 whitespace-pre-wrap text-sm text-foreground">{r.reason}</p>
            <p className="mt-1 text-xs text-muted-foreground">
              From {r.createdByName}
              {r.reviewDate ? ` · Review ${fmt(r.reviewDate)}` : ""}
            </p>
            {r.status === "OPEN" ? (
              <div className="mt-3">
                <Button size="sm" onClick={() => acknowledge(r.id)} disabled={busyId === r.id}>
                  {busyId === r.id ? "Saving…" : "Acknowledge"}
                </Button>
              </div>
            ) : null}
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
