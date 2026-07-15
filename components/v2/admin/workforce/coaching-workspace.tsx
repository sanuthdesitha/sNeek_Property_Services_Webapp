"use client";

/**
 * ESTATE coaching register — filterable table of accountability coaching /
 * warning / management-review records with a create modal and a detail drawer.
 * Read model from GET /api/admin/accountability/coaching; create via POST to the
 * same route; status / outcome updates via PATCH /[id]. Philosophy: these are
 * manager recommendations, not automatic discipline — cleaners acknowledge them
 * in their portal.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { format, parseISO } from "date-fns";
import { ArrowRight, Filter, Plus, RefreshCw } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { EBadge, EButton, ECard, EEyebrow, EEmptyState } from "@/components/v2/ui/primitives";
import { EModal, EField, EInput, ETextarea, ESelect, ESwitch } from "@/components/v2/admin/estate-kit";

const TYPES = ["COACHING", "WARNING", "MANAGEMENT_REVIEW"] as const;
const STATUSES = ["OPEN", "ACKNOWLEDGED", "RESOLVED", "ESCALATED"] as const;
const OUTCOMES = ["NONE", "RETRAINED", "SUSPENDED", "TERMINATED"] as const;

type Tone = "neutral" | "warning" | "danger" | "success" | "info" | "primary";
type Record_ = any;

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

function typeTone(type?: string): Tone {
  return type === "MANAGEMENT_REVIEW" ? "danger" : type === "WARNING" ? "warning" : "neutral";
}

function statusTone(status?: string): Tone {
  switch (status) {
    case "OPEN":
      return "warning";
    case "ACKNOWLEDGED":
      return "info";
    case "RESOLVED":
      return "success";
    case "ESCALATED":
      return "danger";
    default:
      return "neutral";
  }
}

const FIELD_CLS =
  "h-9 rounded-[var(--e-radius-sm)] border border-[hsl(var(--e-input))] bg-[hsl(var(--e-surface))] px-2.5 " +
  "text-[0.8125rem] text-[hsl(var(--e-foreground))] focus:outline-none focus:ring-2 focus:ring-[hsl(var(--e-ring))]";

export function CoachingWorkspace() {
  const [records, setRecords] = useState<Record_[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Record_ | null>(null);
  const [creating, setCreating] = useState(false);

  // Active cleaners for the filter picker + create form (same source other
  // admin pages use: GET /api/admin/users?role=CLEANER returns active cleaners).
  const [cleaners, setCleaners] = useState<{ id: string; name: string }[]>([]);

  // Filters
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
          list.map((u: any) => ({ id: u.id, name: u.name ?? u.email ?? "Cleaner" })).sort(
            (a: any, b: any) => a.name.localeCompare(b.name)
          )
        );
      })
      .catch(() => {});
  }, []);

  const activeFilters =
    Number(Boolean(cleanerId)) + Number(Boolean(type)) + Number(Boolean(status));

  function clearFilters() {
    setCleanerId("");
    setType("");
    setStatus("");
  }

  return (
    <div className="space-y-5">
      {/* ── Filter bar ── */}
      <ECard className="p-4">
        <div className="mb-3 flex items-center gap-2">
          <Filter className="h-3.5 w-3.5 text-[hsl(var(--e-muted-foreground))]" />
          <EEyebrow>Filters</EEyebrow>
          {activeFilters > 0 ? (
            <button
              onClick={clearFilters}
              className="ml-auto text-[0.75rem] underline underline-offset-2 text-[hsl(var(--e-muted-foreground))]"
            >
              Clear ({activeFilters})
            </button>
          ) : null}
        </div>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          <select className={FIELD_CLS} value={cleanerId} onChange={(e) => setCleanerId(e.target.value)}>
            <option value="">All cleaners</option>
            {cleaners.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
          <select className={FIELD_CLS} value={type} onChange={(e) => setType(e.target.value)}>
            <option value="">All types</option>
            {TYPES.map((t) => (
              <option key={t} value={t}>
                {titleCase(t)}
              </option>
            ))}
          </select>
          <select className={FIELD_CLS} value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">Any status</option>
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {titleCase(s)}
              </option>
            ))}
          </select>
        </div>
      </ECard>

      <div className="flex items-center gap-3">
        <p className="text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">
          <span className="e-numeral text-[1.0625rem] text-[hsl(var(--e-foreground))]">{records.length}</span>{" "}
          record{records.length === 1 ? "" : "s"}
        </p>
        <div className="ml-auto flex items-center gap-2">
          <EButton variant="outline" size="sm" onClick={load} disabled={loading}>
            <RefreshCw className={"h-3.5 w-3.5" + (loading ? " animate-spin" : "")} />
            Refresh
          </EButton>
          <EButton variant="gold" size="sm" onClick={() => setCreating(true)}>
            <Plus className="h-3.5 w-3.5" />
            New record
          </EButton>
        </div>
      </div>

      {/* ── Table ── */}
      {loading && records.length === 0 ? (
        <ECard className="px-6 py-16 text-center text-[0.875rem] text-[hsl(var(--e-muted-foreground))]">
          Gathering records…
        </ECard>
      ) : records.length === 0 ? (
        <EEmptyState
          eyebrow="All clear"
          title="No coaching records"
          description="Records are created by managers when a cleaner needs coaching, a warning, or a management review."
        />
      ) : (
        <ECard className="overflow-hidden p-0">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-left text-[0.8125rem]">
              <thead>
                <tr className="border-b border-[hsl(var(--e-border))] text-[0.6875rem] uppercase tracking-[0.08em] text-[hsl(var(--e-text-faint))]">
                  <th className="px-4 py-3 font-[550]">Raised</th>
                  <th className="px-4 py-3 font-[550]">Cleaner</th>
                  <th className="px-4 py-3 font-[550]">Type</th>
                  <th className="px-4 py-3 font-[550]">Reason</th>
                  <th className="px-4 py-3 font-[550]">Status</th>
                  <th className="px-4 py-3 font-[550]">Review</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody>
                {records.map((r) => (
                  <tr
                    key={r.id}
                    className="cursor-pointer border-b border-[hsl(var(--e-border))] transition-colors hover:bg-[hsl(var(--e-muted)/0.4)]"
                    onClick={() => setSelected(r)}
                  >
                    <td className="px-4 py-3 e-tnum text-[hsl(var(--e-text-secondary))]">{fmt(r.createdAt)}</td>
                    <td className="px-4 py-3">{r.cleaner?.name ?? "—"}</td>
                    <td className="px-4 py-3">
                      <EBadge tone={typeTone(r.type)} soft>
                        {titleCase(r.type)}
                      </EBadge>
                    </td>
                    <td className="px-4 py-3 max-w-[280px]">
                      <span className="line-clamp-1 text-[hsl(var(--e-text-secondary))]">{r.reason}</span>
                      {r.retrainingRequired ? (
                        <span className="ml-1.5 text-[0.625rem] font-[600] text-[hsl(var(--e-warning))]">RETRAIN</span>
                      ) : null}
                    </td>
                    <td className="px-4 py-3">
                      <EBadge tone={statusTone(r.status)} soft>
                        {titleCase(r.status)}
                      </EBadge>
                    </td>
                    <td className="px-4 py-3 e-tnum text-[hsl(var(--e-text-secondary))]">{fmt(r.reviewDate)}</td>
                    <td className="px-4 py-3 text-right">
                      <ArrowRight className="inline h-3.5 w-3.5 text-[hsl(var(--e-text-faint))]" />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </ECard>
      )}

      {creating ? (
        <CreateModal
          cleaners={cleaners}
          onClose={() => setCreating(false)}
          onCreated={async () => {
            setCreating(false);
            await load();
          }}
        />
      ) : null}

      {selected ? (
        <RecordDrawer
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

/* ── Create modal ──────────────────────────────────────────────────────── */
function CreateModal({
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
    <EModal open onClose={onClose} wide eyebrow="Accountability" title="New coaching record">
      <div className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <EField label="Cleaner">
            <ESelect value={cleanerId} onChange={(e) => setCleanerId(e.target.value)}>
              <option value="">Select a cleaner…</option>
              {cleaners.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </ESelect>
          </EField>
          <EField label="Type">
            <ESelect value={type} onChange={(e) => setType(e.target.value as (typeof TYPES)[number])}>
              {TYPES.map((t) => (
                <option key={t} value={t}>
                  {titleCase(t)}
                </option>
              ))}
            </ESelect>
          </EField>
        </div>
        <EField label="Reason" hint="What prompted this record. The cleaner will see this.">
          <ETextarea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason for the record…" />
        </EField>
        <EField label="Internal notes" hint="Optional context for managers.">
          <ETextarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Notes (optional)…" />
        </EField>
        <div className="grid gap-4 sm:grid-cols-2">
          <EField label="Review date">
            <EInput type="date" value={reviewDate} onChange={(e) => setReviewDate(e.target.value)} />
          </EField>
          <div className="flex items-end">
            <ESwitch checked={retraining} onCheckedChange={setRetraining} label="Retraining required" />
          </div>
        </div>
        <div className="flex justify-end gap-2 pt-1">
          <EButton variant="outline" size="sm" onClick={onClose} disabled={busy}>
            Cancel
          </EButton>
          <EButton variant="gold" size="sm" onClick={submit} disabled={busy}>
            {busy ? "Creating…" : "Create record"}
          </EButton>
        </div>
      </div>
    </EModal>
  );
}

/* ── Detail drawer with status / outcome controls ──────────────────────── */
function RecordDrawer({
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
        body: JSON.stringify({
          status,
          outcome,
          retrainingRequired: retraining,
          notes: notes.trim() || null,
        }),
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
    <EModal open onClose={onClose} wide eyebrow="Coaching record" title={titleCase(record.type)}>
      <div className="space-y-5">
        <div className="flex flex-wrap items-center gap-2">
          <EBadge tone={typeTone(record.type)} soft>
            {titleCase(record.type)}
          </EBadge>
          <EBadge tone={statusTone(record.status)} soft>
            {titleCase(record.status)}
          </EBadge>
          {record.retrainingRequired ? <EBadge tone="warning" soft>Retraining required</EBadge> : null}
          {record.outcome && record.outcome !== "NONE" ? (
            <EBadge tone="info" soft>Outcome: {titleCase(record.outcome)}</EBadge>
          ) : null}
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <Fact label="Cleaner" value={record.cleaner?.name ?? "—"} />
          <Fact label="Raised by" value={record.createdBy?.name ?? "—"} />
          <Fact label="Raised" value={fmt(record.createdAt)} />
          <Fact label="Review date" value={fmt(record.reviewDate)} />
          {record.acknowledgedAt ? <Fact label="Acknowledged" value={fmt(record.acknowledgedAt)} /> : null}
          {record.patternKey ? <Fact label="Pattern" value={record.patternKey} /> : null}
        </div>

        <div>
          <EEyebrow className="mb-1">Reason</EEyebrow>
          <p className="whitespace-pre-wrap text-[0.875rem] text-[hsl(var(--e-text-secondary))]">{record.reason}</p>
        </div>

        {issueIds.length > 0 ? (
          <EButton variant="outline-gold" size="sm" asChild>
            <Link href="/v2/admin/quality/issues">
              View linked issues ({issueIds.length}) <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </EButton>
        ) : null}

        {/* Update controls */}
        <div className="space-y-3 border-t border-[hsl(var(--e-border))] pt-4">
          <EEyebrow>Update</EEyebrow>
          <div className="grid gap-3 sm:grid-cols-2">
            <EField label="Status">
              <ESelect value={status} onChange={(e) => setStatus(e.target.value)}>
                {STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {titleCase(s)}
                  </option>
                ))}
              </ESelect>
            </EField>
            <EField label="Outcome">
              <ESelect value={outcome} onChange={(e) => setOutcome(e.target.value)}>
                {OUTCOMES.map((o) => (
                  <option key={o} value={o}>
                    {titleCase(o)}
                  </option>
                ))}
              </ESelect>
            </EField>
          </div>
          <EField label="Internal notes">
            <ETextarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Notes (optional)…" />
          </EField>
          <ESwitch checked={retraining} onCheckedChange={setRetraining} label="Retraining required" />
          <div className="flex justify-end">
            <EButton variant="gold" size="sm" onClick={save} disabled={busy}>
              {busy ? "Saving…" : "Save changes"}
            </EButton>
          </div>
        </div>
      </div>
    </EModal>
  );
}

function Fact({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <p className="text-[0.625rem] uppercase tracking-[0.08em] text-[hsl(var(--e-text-faint))]">{label}</p>
      <p className="text-[0.875rem] text-[hsl(var(--e-foreground))]">{value}</p>
    </div>
  );
}
