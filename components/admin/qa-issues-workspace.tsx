"use client";

/**
 * v1 QA issue register — functional mirror of the Estate QA Issues workspace.
 * Filterable table (cleaner / property / category / severity / rectification /
 * false-confirmation / date range) with a detail dialog and per-row actions,
 * all going through PATCH /api/admin/qa/issues/[id]. QA inspectors are
 * read-only (canManage=false).
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { format, parseISO } from "date-fns";
import { ArrowRight, Filter, RefreshCw, ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

const SEVERITIES = ["MINOR", "MAJOR", "CRITICAL"] as const;
const RECTIFICATION_STATUSES = [
  "PENDING",
  "FIXED_BY_QA",
  "RETURNED_TO_CLEANER",
  "FIXED_BY_OTHER_CLEANER",
  "FIXED_BY_MANAGER",
  "NOT_FIXED",
  "ESCALATED",
] as const;
const FALSE_CONF = ["NONE", "SUSPECTED", "CONFIRMED", "REJECTED"] as const;

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
  return value.toLowerCase().split("_").map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
}

function severityCls(severity?: string) {
  return severity === "CRITICAL"
    ? "bg-red-100 text-red-800 border-red-200"
    : severity === "MAJOR"
    ? "bg-amber-100 text-amber-800 border-amber-200"
    : "bg-muted text-muted-foreground border-border";
}

function rectCls(status?: string) {
  switch (status) {
    case "FIXED_BY_QA":
    case "FIXED_BY_OTHER_CLEANER":
    case "FIXED_BY_MANAGER":
      return "bg-green-100 text-green-800 border-green-200";
    case "PENDING":
    case "RETURNED_TO_CLEANER":
      return "bg-amber-100 text-amber-800 border-amber-200";
    case "NOT_FIXED":
    case "ESCALATED":
      return "bg-red-100 text-red-800 border-red-200";
    default:
      return "bg-muted text-muted-foreground border-border";
  }
}

function Pill({ className, children }: { className?: string; children: React.ReactNode }) {
  return (
    <span className={cn("inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-semibold", className)}>
      {children}
    </span>
  );
}

type Issue = any;

export function QaIssuesWorkspace({
  canManage,
  categories = [],
}: {
  canManage: boolean;
  categories?: { key: string; label: string }[];
}) {
  const [issues, setIssues] = useState<Issue[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Issue | null>(null);

  const [cleanerId, setCleanerId] = useState("");
  const [propertyId, setPropertyId] = useState("");
  const [category, setCategory] = useState("");
  const [severity, setSeverity] = useState("");
  const [rectificationStatus, setRectificationStatus] = useState("");
  const [falseConfirmation, setFalseConfirmation] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  const [cleanerOpts, setCleanerOpts] = useState<Record<string, string>>({});
  const [propertyOpts, setPropertyOpts] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (cleanerId) params.set("cleanerId", cleanerId);
      if (propertyId) params.set("propertyId", propertyId);
      if (category) params.set("category", category);
      if (severity) params.set("severity", severity);
      if (rectificationStatus) params.set("rectificationStatus", rectificationStatus);
      if (falseConfirmation) params.set("falseConfirmation", falseConfirmation);
      if (from) params.set("from", from);
      if (to) params.set("to", to);
      const res = await fetch(`/api/admin/qa/issues?${params.toString()}`, { cache: "no-store" });
      const body = await res.json().catch(() => null);
      if (res.ok && body) {
        setIssues(body.issues ?? []);
        setCleanerOpts((prev) => {
          const next = { ...prev };
          for (const i of body.issues ?? []) if (i.cleaner) next[i.cleaner.id] = i.cleaner.name;
          return next;
        });
        setPropertyOpts((prev) => {
          const next = { ...prev };
          for (const i of body.issues ?? []) {
            const p = i.property ?? (i.job ? { id: i.propertyId, name: i.job.propertyName } : null);
            if (p?.id && p.name) next[p.id] = p.name;
          }
          return next;
        });
      }
    } finally {
      setLoading(false);
    }
  }, [cleanerId, propertyId, category, severity, rectificationStatus, falseConfirmation, from, to]);

  useEffect(() => {
    load();
  }, [load]);

  const cleanerList = useMemo(() => Object.entries(cleanerOpts).sort((a, b) => a[1].localeCompare(b[1])), [cleanerOpts]);
  const propertyList = useMemo(() => Object.entries(propertyOpts).sort((a, b) => a[1].localeCompare(b[1])), [propertyOpts]);

  function clearFilters() {
    setCleanerId("");
    setPropertyId("");
    setCategory("");
    setSeverity("");
    setRectificationStatus("");
    setFalseConfirmation("");
    setFrom("");
    setTo("");
  }

  return (
    <div className="space-y-5">
      {/* Filters */}
      <div className="rounded-2xl border border-border/70 bg-surface/80 p-4">
        <div className="mb-3 flex items-center gap-2">
          <Filter className="h-3.5 w-3.5 text-muted-foreground" />
          <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Filters</span>
          <button onClick={clearFilters} className="ml-auto text-xs underline text-muted-foreground">Clear</button>
        </div>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          <select className={SELECT_CLS} value={cleanerId} onChange={(e) => setCleanerId(e.target.value)}>
            <option value="">All cleaners</option>
            {cleanerList.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
          </select>
          <select className={SELECT_CLS} value={propertyId} onChange={(e) => setPropertyId(e.target.value)}>
            <option value="">All properties</option>
            {propertyList.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
          </select>
          <select className={SELECT_CLS} value={category} onChange={(e) => setCategory(e.target.value)}>
            <option value="">All categories</option>
            {categories.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
          </select>
          <select className={SELECT_CLS} value={severity} onChange={(e) => setSeverity(e.target.value)}>
            <option value="">All severities</option>
            {SEVERITIES.map((s) => <option key={s} value={s}>{titleCase(s)}</option>)}
          </select>
          <select className={SELECT_CLS} value={rectificationStatus} onChange={(e) => setRectificationStatus(e.target.value)}>
            <option value="">Any rectification</option>
            {RECTIFICATION_STATUSES.map((s) => <option key={s} value={s}>{titleCase(s)}</option>)}
          </select>
          <select className={SELECT_CLS} value={falseConfirmation} onChange={(e) => setFalseConfirmation(e.target.value)}>
            <option value="">Any false-conf</option>
            {FALSE_CONF.map((s) => <option key={s} value={s}>{titleCase(s)}</option>)}
          </select>
          <input type="date" className={SELECT_CLS} value={from} onChange={(e) => setFrom(e.target.value)} aria-label="From date" />
          <input type="date" className={SELECT_CLS} value={to} onChange={(e) => setTo(e.target.value)} aria-label="To date" />
        </div>
      </div>

      <div className="flex items-center gap-3">
        <p className="text-sm text-muted-foreground">{issues.length} issue{issues.length === 1 ? "" : "s"}</p>
        <Button variant="outline" size="sm" className="ml-auto" onClick={load} disabled={loading}>
          <RefreshCw className={cn("mr-2 h-3.5 w-3.5", loading && "animate-spin")} />
          Refresh
        </Button>
      </div>

      {/* Table */}
      {loading && issues.length === 0 ? (
        <div className="py-16 text-center text-sm text-muted-foreground">Loading…</div>
      ) : issues.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border py-14 text-center text-sm text-muted-foreground">
          No QA issues match these filters.
        </div>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-border/70 bg-surface/80">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[880px] text-left text-sm">
              <thead>
                <tr className="border-b border-border text-[11px] uppercase tracking-wide text-muted-foreground">
                  <th className="px-4 py-3 font-semibold">Raised</th>
                  <th className="px-4 py-3 font-semibold">Cleaner</th>
                  <th className="px-4 py-3 font-semibold">Property / Job</th>
                  <th className="px-4 py-3 font-semibold">Category</th>
                  <th className="px-4 py-3 font-semibold">Severity</th>
                  <th className="px-4 py-3 font-semibold">Rectification</th>
                  <th className="px-4 py-3 font-semibold">False-conf</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody>
                {issues.map((i) => (
                  <tr
                    key={i.id}
                    className="cursor-pointer border-b border-border/60 transition-colors hover:bg-muted/40"
                    onClick={() => setSelected(i)}
                  >
                    <td className="px-4 py-3 tabular-nums text-muted-foreground">{fmt(i.createdAt)}</td>
                    <td className="px-4 py-3">{i.cleaner?.name ?? "—"}</td>
                    <td className="px-4 py-3">
                      <span className="block">{i.job?.propertyName ?? i.property?.name ?? "—"}</span>
                      {i.job?.jobNumber ? <span className="text-[11px] text-muted-foreground">Job #{i.job.jobNumber}</span> : null}
                    </td>
                    <td className="px-4 py-3">
                      {i.category}
                      {i.guestReadyImpact ? <span className="ml-1.5 text-[10px] font-bold text-red-600">GR</span> : null}
                    </td>
                    <td className="px-4 py-3"><Pill className={severityCls(i.severity)}>{i.severity}</Pill></td>
                    <td className="px-4 py-3"><Pill className={rectCls(i.rectificationStatus)}>{titleCase(i.rectificationStatus)}</Pill></td>
                    <td className="px-4 py-3">
                      {i.falseConfirmation && i.falseConfirmation !== "NONE" ? (
                        <Pill className={i.falseConfirmation === "CONFIRMED" ? "bg-red-100 text-red-800 border-red-200" : i.falseConfirmation === "REJECTED" ? "bg-green-100 text-green-800 border-green-200" : "bg-amber-100 text-amber-800 border-amber-200"}>
                          {titleCase(i.falseConfirmation)}
                        </Pill>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right"><ArrowRight className="inline h-3.5 w-3.5 text-muted-foreground" /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <IssueDialog
        issue={selected}
        canManage={canManage}
        onClose={() => setSelected(null)}
        onChanged={async () => {
          await load();
          setSelected(null);
        }}
      />
    </div>
  );
}

function IssueDialog({
  issue,
  canManage,
  onClose,
  onChanged,
}: {
  issue: Issue | null;
  canManage: boolean;
  onClose: () => void;
  onChanged: () => void | Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [action, setAction] = useState<null | "rectify" | "deduction" | "escalate">(null);
  const [rectStatus, setRectStatus] = useState("FIXED_BY_QA");
  const [rectMinutes, setRectMinutes] = useState("");
  const [dedAmount, setDedAmount] = useState("");
  const [dedNote, setDedNote] = useState("");
  const [escReason, setEscReason] = useState("");
  const [photoUrls, setPhotoUrls] = useState<Record<string, string>>({});

  const photoKeys: string[] = useMemo(() => {
    const raw = issue?.qaPhotoKeys;
    if (!Array.isArray(raw)) return [];
    return raw
      .map((p: any) => (typeof p === "string" ? p : p?.annotatedKey ?? p?.key))
      .filter((k: any): k is string => typeof k === "string" && k.length > 0);
  }, [issue]);

  useEffect(() => {
    if (!issue) return;
    setAction(null);
    setRectStatus(issue.rectificationStatus ?? "FIXED_BY_QA");
    setRectMinutes("");
    setDedAmount("");
    setDedNote("");
    setEscReason("");
    setPhotoUrls({});
    let alive = true;
    for (const key of photoKeys) {
      fetch(`/api/uploads/access?key=${encodeURIComponent(key)}&jobId=${encodeURIComponent(issue.jobId)}`)
        .then((r) => (r.ok ? r.json() : null))
        .then((b) => {
          if (alive && b?.url) setPhotoUrls((prev) => ({ ...prev, [key]: b.url }));
        })
        .catch(() => {});
    }
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [issue]);

  async function patch(body: object, successMsg: string) {
    if (!issue) return;
    setBusy(true);
    const res = await fetch(`/api/admin/qa/issues/${issue.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const json = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) {
      toast({ title: "Failed", description: json.error ?? "Action failed", variant: "destructive" });
      return;
    }
    toast({ title: successMsg });
    await onChanged();
  }

  const suspected = issue?.falseConfirmation === "SUSPECTED";

  return (
    <Dialog open={Boolean(issue)} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="sm:max-w-2xl max-h-[85vh] overflow-y-auto">
        {issue ? (
          <>
            <DialogHeader>
              <DialogTitle>{issue.category}</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <div className="flex flex-wrap items-center gap-2">
                <Pill className={severityCls(issue.severity)}>{issue.severity}</Pill>
                <Pill className={rectCls(issue.rectificationStatus)}>{titleCase(issue.rectificationStatus)}</Pill>
                {issue.falseConfirmation && issue.falseConfirmation !== "NONE" ? (
                  <Pill className="bg-muted text-muted-foreground border-border">False conf: {titleCase(issue.falseConfirmation)}</Pill>
                ) : null}
                {issue.guestReadyImpact ? <Pill className="bg-red-100 text-red-800 border-red-200">Guest-ready impact</Pill> : null}
                {issue.cleanerMarkedComplete ? <Pill className="bg-blue-100 text-blue-800 border-blue-200">Cleaner marked complete</Pill> : null}
              </div>

              <div className="grid gap-3 sm:grid-cols-2 text-sm">
                <Fact label="Cleaner" value={issue.cleaner?.name ?? "—"} />
                <Fact label="Raised by" value={issue.raisedBy?.name ?? "—"} />
                <Fact
                  label="Property / Job"
                  value={`${issue.job?.propertyName ?? issue.property?.name ?? "—"}${issue.job?.jobNumber ? ` · Job #${issue.job.jobNumber}` : ""}${issue.job?.scheduledDate ? ` · ${fmt(issue.job.scheduledDate)}` : ""}`}
                />
                <Fact label="Raised" value={fmt(issue.createdAt)} />
                {issue.review ? (
                  <Fact label="Linked review" value={`${issue.review.score != null ? `${Number(issue.review.score).toFixed(0)}%` : "—"}${issue.review.rating ? ` · ${titleCase(issue.review.rating)}` : ""}`} />
                ) : null}
                {issue.payAdjustment ? (
                  <Fact
                    label="Pay adjustment"
                    value={`${titleCase(issue.payAdjustment.status)}${issue.payAdjustment.requestedAmount != null ? ` · $${Math.abs(Number(issue.payAdjustment.requestedAmount)).toFixed(2)}` : ""}${issue.payAdjustment.source ? ` · ${String(issue.payAdjustment.source).replace(/_/g, " ")}` : ""}`}
                  />
                ) : null}
                {issue.rectificationMinutes != null ? <Fact label="Rectification minutes" value={`${issue.rectificationMinutes} min`} /> : null}
              </div>

              <div>
                <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Description</p>
                <p className="mt-1 whitespace-pre-wrap text-sm">{issue.description}</p>
              </div>

              {photoKeys.length > 0 ? (
                <div>
                  <p className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">QA evidence ({photoKeys.length})</p>
                  <div className="flex flex-wrap gap-2">
                    {photoKeys.map((key) =>
                      photoUrls[key] ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <a key={key} href={photoUrls[key]} target="_blank" rel="noreferrer">
                          <img src={photoUrls[key]} alt="QA evidence" className="h-20 w-20 rounded-lg border border-border object-cover" />
                        </a>
                      ) : (
                        <div key={key} className="h-20 w-20 animate-pulse rounded-lg bg-muted" />
                      )
                    )}
                  </div>
                </div>
              ) : null}

              {issue.jobId ? (
                <Button asChild size="sm" variant="outline">
                  <Link href={`/admin/jobs/${issue.jobId}`}>Open job <ArrowRight className="ml-1.5 h-3.5 w-3.5" /></Link>
                </Button>
              ) : null}

              {canManage ? (
                <div className="space-y-3 border-t border-border pt-4">
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Actions</p>
                  <div className="flex flex-wrap gap-2">
                    <Button size="sm" variant={action === "rectify" ? "default" : "outline"} disabled={busy} onClick={() => setAction(action === "rectify" ? null : "rectify")}>Mark rectification</Button>
                    <Button size="sm" variant={action === "deduction" ? "default" : "outline"} disabled={busy} onClick={() => setAction(action === "deduction" ? null : "deduction")}>Propose deduction</Button>
                    <Button size="sm" variant={action === "escalate" ? "default" : "outline"} disabled={busy} onClick={() => setAction(action === "escalate" ? null : "escalate")}>Escalate</Button>
                  </div>

                  {suspected ? (
                    <div className="flex flex-wrap items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3">
                      <ShieldAlert className="h-4 w-4 text-amber-600" />
                      <span className="text-sm text-muted-foreground">Suspected false completion confirmation.</span>
                      <Button size="sm" variant="destructive" disabled={busy} onClick={() => patch({ action: "falseConfirmation", decision: "CONFIRMED" }, "False confirmation confirmed")}>Confirm (−10)</Button>
                      <Button size="sm" variant="outline" disabled={busy} onClick={() => patch({ action: "falseConfirmation", decision: "REJECTED" }, "False confirmation rejected")}>Reject</Button>
                    </div>
                  ) : null}

                  {action === "rectify" ? (
                    <div className="space-y-2 rounded-lg border border-border bg-muted/40 p-3">
                      <div className="flex flex-wrap items-end gap-2">
                        <div className="min-w-[200px] flex-1 space-y-1.5">
                          <Label>Status</Label>
                          <select className={cn(SELECT_CLS, "w-full")} value={rectStatus} onChange={(e) => setRectStatus(e.target.value)}>
                            {RECTIFICATION_STATUSES.map((s) => <option key={s} value={s}>{titleCase(s)}</option>)}
                          </select>
                        </div>
                        <div className="space-y-1.5">
                          <Label>Minutes</Label>
                          <Input type="number" min="0" className="w-28" value={rectMinutes} onChange={(e) => setRectMinutes(e.target.value)} />
                        </div>
                      </div>
                      <Button size="sm" disabled={busy} onClick={() => patch({ action: "rectify", status: rectStatus, minutes: rectMinutes ? Number(rectMinutes) : undefined }, "Rectification updated")}>Save rectification</Button>
                    </div>
                  ) : null}

                  {action === "deduction" ? (
                    <div className="space-y-2 rounded-lg border border-border bg-muted/40 p-3">
                      <div className="flex flex-wrap items-end gap-2">
                        <div className="space-y-1.5">
                          <Label>Amount ($)</Label>
                          <Input type="number" min="0" step="0.01" className="w-32" value={dedAmount} onChange={(e) => setDedAmount(e.target.value)} />
                        </div>
                        <div className="min-w-[200px] flex-1 space-y-1.5">
                          <Label>Note</Label>
                          <Input value={dedNote} onChange={(e) => setDedNote(e.target.value)} placeholder="Reason for the deduction" />
                        </div>
                      </div>
                      <Button
                        size="sm"
                        disabled={busy}
                        onClick={() => {
                          const amount = Number(dedAmount);
                          if (!Number.isFinite(amount) || amount <= 0) { toast({ title: "Enter a valid amount greater than zero.", variant: "destructive" }); return; }
                          if (!dedNote.trim()) { toast({ title: "A note is required.", variant: "destructive" }); return; }
                          patch({ action: "proposeDeduction", amount, note: dedNote.trim() }, "Deduction proposed — pending approval");
                        }}
                      >
                        Propose deduction
                      </Button>
                      <p className="text-xs text-muted-foreground">Creates a pending pay adjustment reviewed in the Approvals centre.</p>
                    </div>
                  ) : null}

                  {action === "escalate" ? (
                    <div className="space-y-2 rounded-lg border border-border bg-muted/40 p-3">
                      <div className="space-y-1.5">
                        <Label>Escalation reason</Label>
                        <Textarea rows={3} value={escReason} onChange={(e) => setEscReason(e.target.value)} placeholder="Why this is being escalated…" />
                      </div>
                      <Button
                        size="sm"
                        disabled={busy}
                        onClick={() => {
                          if (!escReason.trim()) { toast({ title: "A reason is required.", variant: "destructive" }); return; }
                          patch({ action: "escalate", reason: escReason.trim() }, "Issue escalated");
                        }}
                      >
                        Escalate issue
                      </Button>
                    </div>
                  ) : null}
                </div>
              ) : (
                <p className="border-t border-border pt-4 text-xs text-muted-foreground">Read-only view — you do not have permission to action QA issues.</p>
              )}
            </div>
          </>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function Fact({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <p className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="text-sm">{value}</p>
    </div>
  );
}
