"use client";

/**
 * v1 coaching register — filterable table of accountability coaching / warning /
 * management-review records with a create dialog and an inline detail/edit
 * dialog. Mirrors the v2 Estate workspace against GET/POST
 * /api/admin/accountability/coaching and PATCH /[id]. Records are manager
 * recommendations; cleaners acknowledge them in their portal.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { format, parseISO } from "date-fns";
import { ArrowRight, Filter, Plus, RefreshCw } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";

const TYPES = ["COACHING", "WARNING", "MANAGEMENT_REVIEW"] as const;
const STATUSES = ["OPEN", "ACKNOWLEDGED", "RESOLVED", "ESCALATED"] as const;
const OUTCOMES = ["NONE", "RETRAINED", "SUSPENDED", "TERMINATED"] as const;

type Record_ = any;

const SELECT_CLS =
  "h-9 rounded-lg border border-border bg-surface px-2.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring";

function fmt(value: string | Date | null | undefined) {
  if (!value) return "—";
  try {
    return format(typeof value === "string" ? parseISO(value) : value, "dd MMM yyyy");
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

function statusVariant(status?: string): any {
  switch (status) {
    case "OPEN":
      return "warning";
    case "ACKNOWLEDGED":
      return "secondary";
    case "RESOLVED":
      return "success";
    case "ESCALATED":
      return "destructive";
    default:
      return "outline";
  }
}

export function CoachingWorkspace() {
  const [records, setRecords] = useState<Record_[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Record_ | null>(null);
  const [creating, setCreating] = useState(false);
  const [cleaners, setCleaners] = useState<{ id: string; name: string }[]>([]);

  const [cleanerId, setCleanerId] = useState("");
  const [type, setType] = useState("");
  const [status, setStatus] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (cleanerId) params.set("cleanerId", cleanerId);
      if (type) params.set("type", type);
      if (status) params.set("status", status);
      const res = await fetch(`/api/admin/accountability/coaching?${params.toString()}`, {
        cache: "no-store",
      });
      const body = await res.json().catch(() => null);
      if (res.ok && body) setRecords(body.records ?? []);
    } finally {
      setLoading(false);
    }
  }, [cleanerId, type, status]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    fetch("/api/admin/users?role=CLEANER", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : []))
      .then((data) => {
        const list = Array.isArray(data) ? data : data?.users ?? [];
        setCleaners(
          list
            .map((u: any) => ({ id: u.id, name: u.name ?? u.email ?? "Cleaner" }))
            .sort((a: any, b: any) => a.name.localeCompare(b.name))
        );
      })
      .catch(() => {});
  }, []);

  const activeFilters = Number(Boolean(cleanerId)) + Number(Boolean(type)) + Number(Boolean(status));

  return (
    <div className="space-y-4">
      {/* Filter bar */}
      <Card>
        <CardContent className="p-4">
          <div className="mb-3 flex items-center gap-2">
            <Filter className="h-4 w-4 text-muted-foreground" />
            <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Filters</span>
            {activeFilters > 0 ? (
              <button
                onClick={() => {
                  setCleanerId("");
                  setType("");
                  setStatus("");
                }}
                className="ml-auto text-xs text-muted-foreground underline underline-offset-2"
              >
                Clear ({activeFilters})
              </button>
            ) : null}
          </div>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            <select className={SELECT_CLS} value={cleanerId} onChange={(e) => setCleanerId(e.target.value)}>
              <option value="">All cleaners</option>
              {cleaners.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
            <select className={SELECT_CLS} value={type} onChange={(e) => setType(e.target.value)}>
              <option value="">All types</option>
              {TYPES.map((t) => (
                <option key={t} value={t}>
                  {titleCase(t)}
                </option>
              ))}
            </select>
            <select className={SELECT_CLS} value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="">Any status</option>
              {STATUSES.map((s) => (
                <option key={s} value={s}>
                  {titleCase(s)}
                </option>
              ))}
            </select>
          </div>
        </CardContent>
      </Card>

      <div className="flex items-center gap-3">
        <p className="text-sm text-muted-foreground">
          <span className="font-semibold text-foreground">{records.length}</span> record
          {records.length === 1 ? "" : "s"}
        </p>
        <div className="ml-auto flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={load} disabled={loading}>
            <RefreshCw className={"h-4 w-4" + (loading ? " animate-spin" : "")} />
            Refresh
          </Button>
          <Button size="sm" onClick={() => setCreating(true)}>
            <Plus className="h-4 w-4" />
            New record
          </Button>
        </div>
      </div>

      {/* Table */}
      {loading && records.length === 0 ? (
        <Card>
          <CardContent className="px-6 py-16 text-center text-sm text-muted-foreground">Gathering records…</CardContent>
        </Card>
      ) : records.length === 0 ? (
        <Card>
          <CardContent className="px-6 py-16 text-center">
            <p className="text-sm font-semibold">No coaching records</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Records are created by managers when a cleaner needs coaching, a warning, or a management review.
            </p>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[760px] text-left text-sm">
                <thead>
                  <tr className="border-b border-border text-[11px] uppercase tracking-wide text-muted-foreground">
                    <th className="px-4 py-3 font-semibold">Raised</th>
                    <th className="px-4 py-3 font-semibold">Cleaner</th>
                    <th className="px-4 py-3 font-semibold">Type</th>
                    <th className="px-4 py-3 font-semibold">Reason</th>
                    <th className="px-4 py-3 font-semibold">Status</th>
                    <th className="px-4 py-3 font-semibold">Review</th>
                    <th className="px-4 py-3" />
                  </tr>
                </thead>
                <tbody>
                  {records.map((r) => (
                    <tr
                      key={r.id}
                      className="cursor-pointer border-b border-border transition-colors hover:bg-surface-raised"
                      onClick={() => setSelected(r)}
                    >
                      <td className="px-4 py-3 text-muted-foreground">{fmt(r.createdAt)}</td>
                      <td className="px-4 py-3">{r.cleaner?.name ?? "—"}</td>
                      <td className="px-4 py-3">
                        <Badge variant={typeVariant(r.type)}>{titleCase(r.type)}</Badge>
                      </td>
                      <td className="max-w-[280px] px-4 py-3">
                        <span className="line-clamp-1 text-muted-foreground">{r.reason}</span>
                        {r.retrainingRequired ? (
                          <span className="ml-1.5 text-[10px] font-semibold text-warning">RETRAIN</span>
                        ) : null}
                      </td>
                      <td className="px-4 py-3">
                        <Badge variant={statusVariant(r.status)}>{titleCase(r.status)}</Badge>
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">{fmt(r.reviewDate)}</td>
                      <td className="px-4 py-3 text-right">
                        <ArrowRight className="inline h-4 w-4 text-muted-foreground" />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      {creating ? (
        <CreateDialog
          cleaners={cleaners}
          onClose={() => setCreating(false)}
          onCreated={async () => {
            setCreating(false);
            await load();
          }}
        />
      ) : null}

      {selected ? (
        <RecordDialog
          record={selected}
          onClose={() => setSelected(null)}
          onChanged={async () => {
            await load();
            setSelected(null);
          }}
        />
      ) : null}
    </div>
  );
}

function CreateDialog({
  cleaners,
  onClose,
  onCreated,
}: {
  cleaners: { id: string; name: string }[];
  onClose: () => void;
  onCreated: () => void | Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [cleanerId, setCleanerId] = useState("");
  const [type, setType] = useState<(typeof TYPES)[number]>("COACHING");
  const [reason, setReason] = useState("");
  const [notes, setNotes] = useState("");
  const [retraining, setRetraining] = useState(false);
  const [reviewDate, setReviewDate] = useState("");

  async function submit() {
    if (!cleanerId) {
      toast({ title: "Select a cleaner.", variant: "destructive" });
      return;
    }
    if (!reason.trim()) {
      toast({ title: "A reason is required.", variant: "destructive" });
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/admin/accountability/coaching", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          cleanerId,
          type,
          reason: reason.trim(),
          notes: notes.trim() || undefined,
          retrainingRequired: retraining,
          reviewDate: reviewDate ? new Date(reviewDate).toISOString() : undefined,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error ?? "Could not create record");
      toast({ title: "Coaching record created" });
      await onCreated();
    } catch (err: any) {
      toast({ title: "Failed", description: err?.message ?? "Could not create", variant: "destructive" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>New coaching record</DialogTitle>
          <DialogDescription>A recommendation authored by management — the cleaner acknowledges it.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>Cleaner</Label>
              <select className={SELECT_CLS + " w-full"} value={cleanerId} onChange={(e) => setCleanerId(e.target.value)}>
                <option value="">Select a cleaner…</option>
                {cleaners.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label>Type</Label>
              <select
                className={SELECT_CLS + " w-full"}
                value={type}
                onChange={(e) => setType(e.target.value as (typeof TYPES)[number])}
              >
                {TYPES.map((t) => (
                  <option key={t} value={t}>
                    {titleCase(t)}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>Reason</Label>
            <Textarea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason for the record…" />
          </div>
          <div className="space-y-1.5">
            <Label>Internal notes</Label>
            <Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Notes (optional)…" />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>Review date</Label>
              <Input type="date" value={reviewDate} onChange={(e) => setReviewDate(e.target.value)} />
            </div>
            <div className="flex items-center gap-2 pt-6">
              <Switch checked={retraining} onCheckedChange={setRetraining} />
              <Label>Retraining required</Label>
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-1">
            <Button variant="outline" size="sm" onClick={onClose} disabled={busy}>
              Cancel
            </Button>
            <Button size="sm" onClick={submit} disabled={busy}>
              {busy ? "Creating…" : "Create record"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function RecordDialog({
  record,
  onClose,
  onChanged,
}: {
  record: Record_;
  onClose: () => void;
  onChanged: () => void | Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string>(record.status ?? "OPEN");
  const [outcome, setOutcome] = useState<string>(record.outcome ?? "NONE");
  const [retraining, setRetraining] = useState<boolean>(Boolean(record.retrainingRequired));
  const [notes, setNotes] = useState<string>(record.notes ?? "");

  const issueIds: string[] = useMemo(() => {
    const raw = record.issueIds;
    return Array.isArray(raw) ? raw.filter((x: any) => typeof x === "string") : [];
  }, [record]);

  async function save() {
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/accountability/coaching/${record.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status, outcome, retrainingRequired: retraining, notes: notes.trim() || null }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error ?? "Update failed");
      toast({ title: "Record updated" });
      await onChanged();
    } catch (err: any) {
      toast({ title: "Failed", description: err?.message ?? "Update failed", variant: "destructive" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{titleCase(record.type)}</DialogTitle>
          <DialogDescription>Raised {fmt(record.createdAt)} · {record.cleaner?.name ?? "—"}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={typeVariant(record.type)}>{titleCase(record.type)}</Badge>
            <Badge variant={statusVariant(record.status)}>{titleCase(record.status)}</Badge>
            {record.retrainingRequired ? <Badge variant="warning">Retraining required</Badge> : null}
            {record.outcome && record.outcome !== "NONE" ? (
              <Badge variant="secondary">Outcome: {titleCase(record.outcome)}</Badge>
            ) : null}
          </div>

          <div className="grid gap-3 sm:grid-cols-2 text-sm">
            <Fact label="Raised by" value={record.createdBy?.name ?? "—"} />
            <Fact label="Review date" value={fmt(record.reviewDate)} />
            {record.acknowledgedAt ? <Fact label="Acknowledged" value={fmt(record.acknowledgedAt)} /> : null}
            {record.patternKey ? <Fact label="Pattern" value={record.patternKey} /> : null}
          </div>

          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Reason</p>
            <p className="mt-1 whitespace-pre-wrap text-sm text-foreground">{record.reason}</p>
          </div>

          {issueIds.length > 0 ? (
            <Button variant="outline" size="sm" asChild>
              <Link href="/admin/quality/issues">
                View linked issues ({issueIds.length}) <ArrowRight className="h-4 w-4" />
              </Link>
            </Button>
          ) : null}

          <div className="space-y-3 border-t border-border pt-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Update</p>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Status</Label>
                <select className={SELECT_CLS + " w-full"} value={status} onChange={(e) => setStatus(e.target.value)}>
                  {STATUSES.map((s) => (
                    <option key={s} value={s}>
                      {titleCase(s)}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1.5">
                <Label>Outcome</Label>
                <select className={SELECT_CLS + " w-full"} value={outcome} onChange={(e) => setOutcome(e.target.value)}>
                  {OUTCOMES.map((o) => (
                    <option key={o} value={o}>
                      {titleCase(o)}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Internal notes</Label>
              <Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Notes (optional)…" />
            </div>
            <div className="flex items-center gap-2">
              <Switch checked={retraining} onCheckedChange={setRetraining} />
              <Label>Retraining required</Label>
            </div>
            <div className="flex justify-end">
              <Button size="sm" onClick={save} disabled={busy}>
                {busy ? "Saving…" : "Save changes"}
              </Button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Fact({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="text-sm text-foreground">{value}</p>
    </div>
  );
}
