"use client";

/**
 * ESTATE QA issue register — filterable table of accountability QA issues with a
 * detail drawer and per-row actions. Read model from GET /api/admin/qa/issues;
 * every mutation goes through PATCH /api/admin/qa/issues/[id] (rectify,
 * proposeDeduction, escalate, falseConfirmation). QA inspectors get read-only
 * access (canManage=false hides the action forms).
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { format, parseISO } from "date-fns";
import { ArrowRight, Filter, RefreshCw, ShieldAlert } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { EBadge, EButton, ECard, EEyebrow, EEmptyState } from "@/components/v2/ui/primitives";
import { EModal, EField, EInput, ETextarea, ESelect } from "@/components/v2/admin/estate-kit";

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

function severityTone(severity?: string): "danger" | "warning" | "neutral" {
  return severity === "CRITICAL" ? "danger" : severity === "MAJOR" ? "warning" : "neutral";
}

function rectTone(status?: string): "success" | "warning" | "danger" | "info" | "neutral" {
  switch (status) {
    case "FIXED_BY_QA":
    case "FIXED_BY_OTHER_CLEANER":
    case "FIXED_BY_MANAGER":
      return "success";
    case "PENDING":
    case "RETURNED_TO_CLEANER":
      return "warning";
    case "NOT_FIXED":
    case "ESCALATED":
      return "danger";
    default:
      return "neutral";
  }
}

function falseConfTone(status?: string): "danger" | "warning" | "success" | "neutral" {
  switch (status) {
    case "SUSPECTED":
      return "warning";
    case "CONFIRMED":
      return "danger";
    case "REJECTED":
      return "success";
    default:
      return "neutral";
  }
}

type Issue = any;

const FIELD_CLS =
  "h-9 rounded-[var(--e-radius-sm)] border border-[hsl(var(--e-input))] bg-[hsl(var(--e-surface))] px-2.5 " +
  "text-[0.8125rem] text-[hsl(var(--e-foreground))] focus:outline-none focus:ring-2 focus:ring-[hsl(var(--e-ring))]";

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

  // Filters
  const [cleanerId, setCleanerId] = useState("");
  const [propertyId, setPropertyId] = useState("");
  const [category, setCategory] = useState("");
  const [severity, setSeverity] = useState("");
  const [rectificationStatus, setRectificationStatus] = useState("");
  const [falseConfirmation, setFalseConfirmation] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  // Distinct cleaner/property options accumulate across loads (the API filters
  // server-side; these lists give the admin quick pickers).
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

  const activeFilters =
    Number(Boolean(cleanerId)) +
    Number(Boolean(propertyId)) +
    Number(Boolean(category)) +
    Number(Boolean(severity)) +
    Number(Boolean(rectificationStatus)) +
    Number(Boolean(falseConfirmation)) +
    Number(Boolean(from)) +
    Number(Boolean(to));

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

  const cleanerList = useMemo(() => Object.entries(cleanerOpts).sort((a, b) => a[1].localeCompare(b[1])), [cleanerOpts]);
  const propertyList = useMemo(
    () => Object.entries(propertyOpts).sort((a, b) => a[1].localeCompare(b[1])),
    [propertyOpts]
  );

  return (
    <div className="space-y-5">
      {/* ── Filter bar ── */}
      <ECard className="p-4">
        <div className="mb-3 flex items-center gap-2">
          <Filter className="h-3.5 w-3.5 text-[hsl(var(--e-muted-foreground))]" />
          <EEyebrow>Filters</EEyebrow>
          {activeFilters > 0 ? (
            <button onClick={clearFilters} className="ml-auto text-[0.75rem] underline underline-offset-2 text-[hsl(var(--e-muted-foreground))]">
              Clear ({activeFilters})
            </button>
          ) : null}
        </div>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          <select className={FIELD_CLS} value={cleanerId} onChange={(e) => setCleanerId(e.target.value)}>
            <option value="">All cleaners</option>
            {cleanerList.map(([id, name]) => (
              <option key={id} value={id}>{name}</option>
            ))}
          </select>
          <select className={FIELD_CLS} value={propertyId} onChange={(e) => setPropertyId(e.target.value)}>
            <option value="">All properties</option>
            {propertyList.map(([id, name]) => (
              <option key={id} value={id}>{name}</option>
            ))}
          </select>
          <select className={FIELD_CLS} value={category} onChange={(e) => setCategory(e.target.value)}>
            <option value="">All categories</option>
            {categories.map((c) => (
              <option key={c.key} value={c.key}>{c.label}</option>
            ))}
          </select>
          <select className={FIELD_CLS} value={severity} onChange={(e) => setSeverity(e.target.value)}>
            <option value="">All severities</option>
            {SEVERITIES.map((s) => (
              <option key={s} value={s}>{titleCase(s)}</option>
            ))}
          </select>
          <select className={FIELD_CLS} value={rectificationStatus} onChange={(e) => setRectificationStatus(e.target.value)}>
            <option value="">Any rectification</option>
            {RECTIFICATION_STATUSES.map((s) => (
              <option key={s} value={s}>{titleCase(s)}</option>
            ))}
          </select>
          <select className={FIELD_CLS} value={falseConfirmation} onChange={(e) => setFalseConfirmation(e.target.value)}>
            <option value="">Any false-conf</option>
            {FALSE_CONF.map((s) => (
              <option key={s} value={s}>{titleCase(s)}</option>
            ))}
          </select>
          <input type="date" className={FIELD_CLS} value={from} onChange={(e) => setFrom(e.target.value)} aria-label="From date" />
          <input type="date" className={FIELD_CLS} value={to} onChange={(e) => setTo(e.target.value)} aria-label="To date" />
        </div>
      </ECard>

      <div className="flex items-center gap-3">
        <p className="text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">
          <span className="e-numeral text-[1.0625rem] text-[hsl(var(--e-foreground))]">{issues.length}</span> issue{issues.length === 1 ? "" : "s"}
        </p>
        <EButton variant="outline" size="sm" className="ml-auto" onClick={load} disabled={loading}>
          <RefreshCw className={"h-3.5 w-3.5" + (loading ? " animate-spin" : "")} />
          Refresh
        </EButton>
      </div>

      {/* ── Table ── */}
      {loading && issues.length === 0 ? (
        <ECard className="px-6 py-16 text-center text-[0.875rem] text-[hsl(var(--e-muted-foreground))]">Gathering issues…</ECard>
      ) : issues.length === 0 ? (
        <EEmptyState eyebrow="All clear" title="No QA issues match" description="Adjust the filters or check back after the next inspection." />
      ) : (
        <ECard className="overflow-hidden p-0">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[880px] text-left text-[0.8125rem]">
              <thead>
                <tr className="border-b border-[hsl(var(--e-border))] text-[0.6875rem] uppercase tracking-[0.08em] text-[hsl(var(--e-text-faint))]">
                  <th className="px-4 py-3 font-[550]">Raised</th>
                  <th className="px-4 py-3 font-[550]">Cleaner</th>
                  <th className="px-4 py-3 font-[550]">Property / Job</th>
                  <th className="px-4 py-3 font-[550]">Category</th>
                  <th className="px-4 py-3 font-[550]">Severity</th>
                  <th className="px-4 py-3 font-[550]">Rectification</th>
                  <th className="px-4 py-3 font-[550]">False-conf</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody>
                {issues.map((i) => (
                  <tr
                    key={i.id}
                    className="cursor-pointer border-b border-[hsl(var(--e-border))] transition-colors hover:bg-[hsl(var(--e-muted)/0.4)]"
                    onClick={() => setSelected(i)}
                  >
                    <td className="px-4 py-3 e-tnum text-[hsl(var(--e-text-secondary))]">{fmt(i.createdAt)}</td>
                    <td className="px-4 py-3">{i.cleaner?.name ?? "—"}</td>
                    <td className="px-4 py-3">
                      <span className="block">{i.job?.propertyName ?? i.property?.name ?? "—"}</span>
                      {i.job?.jobNumber ? <span className="text-[0.6875rem] text-[hsl(var(--e-text-faint))]">Job #{i.job.jobNumber}</span> : null}
                    </td>
                    <td className="px-4 py-3">
                      {i.category}
                      {i.guestReadyImpact ? <span className="ml-1.5 text-[0.625rem] font-[600] text-[hsl(var(--e-danger))]">GR</span> : null}
                    </td>
                    <td className="px-4 py-3"><EBadge tone={severityTone(i.severity)} soft>{i.severity}</EBadge></td>
                    <td className="px-4 py-3"><EBadge tone={rectTone(i.rectificationStatus)} soft>{titleCase(i.rectificationStatus)}</EBadge></td>
                    <td className="px-4 py-3">
                      {i.falseConfirmation && i.falseConfirmation !== "NONE" ? (
                        <EBadge tone={falseConfTone(i.falseConfirmation)} soft>{titleCase(i.falseConfirmation)}</EBadge>
                      ) : (
                        <span className="text-[hsl(var(--e-text-faint))]">—</span>
                      )}
                    </td>
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

      {selected ? (
        <IssueDrawer
          issue={selected}
          canManage={canManage}
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

/* ── Detail drawer with inline action forms ─────────────────────────────── */
function IssueDrawer({
  issue,
  canManage,
  onClose,
  onChanged,
}: {
  issue: Issue;
  canManage: boolean;
  onClose: () => void;
  onChanged: () => void | Promise<void>;
}) {
  const [action, setAction] = useState<null | "rectify" | "deduction" | "escalate">(null);
  const [busy, setBusy] = useState(false);

  // rectify
  const [rectStatus, setRectStatus] = useState(issue.rectificationStatus ?? "FIXED_BY_QA");
  const [rectMinutes, setRectMinutes] = useState("");
  // deduction
  const [dedAmount, setDedAmount] = useState("");
  const [dedNote, setDedNote] = useState("");
  // escalate
  const [escReason, setEscReason] = useState("");

  // QA photos → presigned urls
  const [photoUrls, setPhotoUrls] = useState<Record<string, string>>({});
  const photoKeys: string[] = useMemo(() => {
    const raw = issue.qaPhotoKeys;
    if (!Array.isArray(raw)) return [];
    return raw
      .map((p: any) => (typeof p === "string" ? p : p?.annotatedKey ?? p?.key))
      .filter((k: any): k is string => typeof k === "string" && k.length > 0);
  }, [issue]);

  useEffect(() => {
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
  }, [photoKeys, issue.jobId]);

  async function patch(body: object, successMsg: string) {
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/qa/issues/${issue.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error ?? "Action failed");
      toast({ title: successMsg });
      await onChanged();
    } catch (err: any) {
      toast({ title: "Failed", description: err?.message ?? "Action failed", variant: "destructive" });
    } finally {
      setBusy(false);
    }
  }

  const suspected = issue.falseConfirmation === "SUSPECTED";

  return (
    <EModal open onClose={onClose} wide eyebrow="QA issue" title={issue.category}>
      <div className="space-y-5">
        {/* Badges */}
        <div className="flex flex-wrap items-center gap-2">
          <EBadge tone={severityTone(issue.severity)} soft>{issue.severity}</EBadge>
          <EBadge tone={rectTone(issue.rectificationStatus)} soft>{titleCase(issue.rectificationStatus)}</EBadge>
          {issue.falseConfirmation && issue.falseConfirmation !== "NONE" ? (
            <EBadge tone={falseConfTone(issue.falseConfirmation)} soft>False conf: {titleCase(issue.falseConfirmation)}</EBadge>
          ) : null}
          {issue.guestReadyImpact ? <EBadge tone="danger" soft>Guest-ready impact</EBadge> : null}
          {issue.cleanerMarkedComplete ? <EBadge tone="info" soft>Cleaner marked complete</EBadge> : null}
        </div>

        {/* Facts */}
        <div className="grid gap-3 sm:grid-cols-2">
          <Fact label="Cleaner" value={issue.cleaner?.name ?? "—"} />
          <Fact label="Raised by" value={issue.raisedBy?.name ?? "—"} />
          <Fact
            label="Property / Job"
            value={
              <>
                {issue.job?.propertyName ?? issue.property?.name ?? "—"}
                {issue.job?.jobNumber ? ` · Job #${issue.job.jobNumber}` : ""}
                {issue.job?.scheduledDate ? ` · ${fmt(issue.job.scheduledDate)}` : ""}
              </>
            }
          />
          <Fact label="Raised" value={fmt(issue.createdAt)} />
          {issue.review ? (
            <Fact
              label="Linked review"
              value={
                <>
                  {issue.review.score != null ? `${Number(issue.review.score).toFixed(0)}%` : "—"}
                  {issue.review.rating ? ` · ${titleCase(issue.review.rating)}` : ""}
                </>
              }
            />
          ) : null}
          {issue.payAdjustment ? (
            <Fact
              label="Pay adjustment"
              value={
                <>
                  {titleCase(issue.payAdjustment.status) ?? "—"}
                  {issue.payAdjustment.requestedAmount != null
                    ? ` · $${Math.abs(Number(issue.payAdjustment.requestedAmount)).toFixed(2)}`
                    : ""}
                  {issue.payAdjustment.source ? ` · ${String(issue.payAdjustment.source).replace(/_/g, " ")}` : ""}
                </>
              }
            />
          ) : null}
          {issue.rectificationMinutes != null ? (
            <Fact label="Rectification minutes" value={`${issue.rectificationMinutes} min`} />
          ) : null}
        </div>

        <div>
          <EEyebrow className="mb-1">Description</EEyebrow>
          <p className="whitespace-pre-wrap text-[0.875rem] text-[hsl(var(--e-text-secondary))]">{issue.description}</p>
        </div>

        {/* QA photos */}
        {photoKeys.length > 0 ? (
          <div>
            <EEyebrow className="mb-2">QA evidence ({photoKeys.length})</EEyebrow>
            <div className="flex flex-wrap gap-2">
              {photoKeys.map((key) =>
                photoUrls[key] ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <a key={key} href={photoUrls[key]} target="_blank" rel="noreferrer">
                    <img
                      src={photoUrls[key]}
                      alt="QA evidence"
                      className="h-20 w-20 rounded-[var(--e-radius-sm)] border border-[hsl(var(--e-border))] object-cover"
                    />
                  </a>
                ) : (
                  <div key={key} className="h-20 w-20 animate-pulse rounded-[var(--e-radius-sm)] bg-[hsl(var(--e-muted))]" />
                )
              )}
            </div>
          </div>
        ) : null}

        {/* Job link */}
        {issue.jobId ? (
          <EButton variant="outline-gold" size="sm" asChild>
            <Link href={`/v2/admin/jobs/${issue.jobId}`}>
              Open job <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </EButton>
        ) : null}

        {/* Actions */}
        {canManage ? (
          <div className="space-y-3 border-t border-[hsl(var(--e-border))] pt-4">
            <EEyebrow>Actions</EEyebrow>
            <div className="flex flex-wrap gap-2">
              <EButton size="sm" variant={action === "rectify" ? "gold" : "outline"} disabled={busy} onClick={() => setAction(action === "rectify" ? null : "rectify")}>
                Mark rectification
              </EButton>
              <EButton size="sm" variant={action === "deduction" ? "gold" : "outline"} disabled={busy} onClick={() => setAction(action === "deduction" ? null : "deduction")}>
                Propose deduction
              </EButton>
              <EButton size="sm" variant={action === "escalate" ? "gold" : "outline"} disabled={busy} onClick={() => setAction(action === "escalate" ? null : "escalate")}>
                Escalate
              </EButton>
            </div>

            {suspected ? (
              <div className="flex flex-wrap items-center gap-2 rounded-[var(--e-radius-sm)] border border-[hsl(var(--e-warning)/0.4)] bg-[hsl(var(--e-warning)/0.08)] p-3">
                <ShieldAlert className="h-4 w-4 text-[hsl(var(--e-warning))]" />
                <span className="text-[0.8125rem] text-[hsl(var(--e-text-secondary))]">Suspected false completion confirmation.</span>
                <EButton
                  size="sm"
                  variant="danger"
                  disabled={busy}
                  onClick={() => patch({ action: "falseConfirmation", decision: "CONFIRMED" }, "False confirmation confirmed")}
                >
                  Confirm (−10)
                </EButton>
                <EButton
                  size="sm"
                  variant="outline"
                  disabled={busy}
                  onClick={() => patch({ action: "falseConfirmation", decision: "REJECTED" }, "False confirmation rejected")}
                >
                  Reject
                </EButton>
              </div>
            ) : null}

            {action === "rectify" ? (
              <div className="space-y-2 rounded-[var(--e-radius-sm)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-muted)/0.4)] p-3">
                <div className="flex flex-wrap items-end gap-2">
                  <EField label="Status" className="min-w-[200px] flex-1">
                    <ESelect value={rectStatus} onChange={(e) => setRectStatus(e.target.value)}>
                      {RECTIFICATION_STATUSES.map((s) => (
                        <option key={s} value={s}>{titleCase(s)}</option>
                      ))}
                    </ESelect>
                  </EField>
                  <EField label="Minutes">
                    <EInput type="number" min="0" className="w-28" value={rectMinutes} onChange={(e) => setRectMinutes(e.target.value)} />
                  </EField>
                </div>
                <EButton
                  size="sm"
                  variant="gold"
                  disabled={busy}
                  onClick={() =>
                    patch(
                      {
                        action: "rectify",
                        status: rectStatus,
                        minutes: rectMinutes ? Number(rectMinutes) : undefined,
                      },
                      "Rectification updated"
                    )
                  }
                >
                  Save rectification
                </EButton>
              </div>
            ) : null}

            {action === "deduction" ? (
              <div className="space-y-2 rounded-[var(--e-radius-sm)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-muted)/0.4)] p-3">
                <div className="flex flex-wrap items-end gap-2">
                  <EField label="Amount ($)">
                    <EInput type="number" min="0" step="0.01" className="w-32" value={dedAmount} onChange={(e) => setDedAmount(e.target.value)} />
                  </EField>
                  <EField label="Note" className="min-w-[220px] flex-1">
                    <EInput value={dedNote} onChange={(e) => setDedNote(e.target.value)} placeholder="Reason for the deduction" />
                  </EField>
                </div>
                <EButton
                  size="sm"
                  variant="gold"
                  disabled={busy}
                  onClick={() => {
                    const amount = Number(dedAmount);
                    if (!Number.isFinite(amount) || amount <= 0) {
                      toast({ title: "Enter a valid amount greater than zero.", variant: "destructive" });
                      return;
                    }
                    if (!dedNote.trim()) {
                      toast({ title: "A note is required.", variant: "destructive" });
                      return;
                    }
                    patch({ action: "proposeDeduction", amount, note: dedNote.trim() }, "Deduction proposed — pending approval");
                  }}
                >
                  Propose deduction
                </EButton>
                <p className="text-[0.6875rem] text-[hsl(var(--e-text-faint))]">Creates a pending pay adjustment reviewed in the Approvals centre.</p>
              </div>
            ) : null}

            {action === "escalate" ? (
              <div className="space-y-2 rounded-[var(--e-radius-sm)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-muted)/0.4)] p-3">
                <EField label="Escalation reason">
                  <ETextarea rows={3} value={escReason} onChange={(e) => setEscReason(e.target.value)} placeholder="Why this is being escalated…" />
                </EField>
                <EButton
                  size="sm"
                  variant="gold"
                  disabled={busy}
                  onClick={() => {
                    if (!escReason.trim()) {
                      toast({ title: "A reason is required.", variant: "destructive" });
                      return;
                    }
                    patch({ action: "escalate", reason: escReason.trim() }, "Issue escalated");
                  }}
                >
                  Escalate issue
                </EButton>
              </div>
            ) : null}
          </div>
        ) : (
          <p className="border-t border-[hsl(var(--e-border))] pt-4 text-[0.75rem] text-[hsl(var(--e-text-faint))]">
            Read-only view — you do not have permission to action QA issues.
          </p>
        )}
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
