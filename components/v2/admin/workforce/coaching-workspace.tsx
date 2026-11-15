"use client";

/**
 * ESTATE coaching register — filterable table of accountability coaching /
 * warning / management-review records with a create modal and a detail drawer.
 * Read model from GET /api/admin/accountability/coaching; create via POST to the
 * same route; status / outcome updates via PATCH /[id]. Philosophy: these are
 * manager recommendations, not automatic discipline — cleaners acknowledge them
 * in their portal.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { format, parseISO } from "date-fns";
import { ArrowRight, Plus, RefreshCw } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { EAlert, EBadge, EButton, ECard, EEyebrow, EEmptyState } from "@/components/v2/ui/primitives";
import { EModal, EField, EInput, ETextarea, ESelect, ESwitch } from "@/components/v2/admin/estate-kit";
import { EFilterChips } from "@/components/v2/ui/filter-chips";
import { ESidePanel } from "@/components/v2/ui/side-panel";
import { EConfirmDialog } from "@/components/v2/ui/confirm-dialog";
import { ETonePill, tonePhoneBandClass, toneRowCellClass } from "@/components/v2/ui/tone-band";
import { isDismissalOutcome } from "@/lib/workforce/coaching-outcomes";
import { sensitiveVerificationText, type SensitiveCredentialsInput } from "@/lib/security/pin-rules";

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

type CleanerOption = { id: string; name: string };

/**
 * `canManage` false hides create and update controls (the caller knows the
 * viewer's pack is read-only; the API would refuse them anyway).
 */
export function CoachingWorkspace({ canManage = true }: { canManage?: boolean } = {}) {
  const [records, setRecords] = useState<Record_[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [cleanersError, setCleanersError] = useState(false);
  const loadController = useRef<AbortController | null>(null);
  const [selected, setSelected] = useState<Record_ | null>(null);
  const [creating, setCreating] = useState(false);

  // Active cleaners for the filter picker + create form (same source other
  // admin pages use: GET /api/admin/users?role=CLEANER returns active cleaners).
  const [cleaners, setCleaners] = useState<CleanerOption[]>([]);

  // Filters. The list opens on open records (board "Workforce" › Coaching).
  const [cleanerId, setCleanerId] = useState("");
  const [type, setType] = useState("");
  const [status, setStatus] = useState("OPEN");
  const [statusCounts, setStatusCounts] = useState<Record<string, number> | null>(null);
  const [canRecordDismissal, setCanRecordDismissal] = useState(false);

  // A newer filter read cancels the older one, so a late answer for an old
  // filter can never replace the list on screen. A failed read is shown as a
  // failure, not as "No coaching records".
  const load = useCallback(async () => {
    loadController.current?.abort();
    const controller = new AbortController();
    loadController.current = controller;
    setLoading(true);
    setLoadError(null);
    try {
      const params = new URLSearchParams();
      if (cleanerId) params.set("cleanerId", cleanerId);
      if (type) params.set("type", type);
      if (status) params.set("status", status);
      const res = await fetch(`/api/admin/accountability/coaching?${params.toString()}`, {
        cache: "no-store",
        signal: controller.signal,
      });
      const body = await res.json().catch(() => null);
      if (controller.signal.aborted) return;
      if (res.ok && body && Array.isArray(body.records)) {
        setRecords(body.records);
        setStatusCounts(body.statusCounts && typeof body.statusCounts === "object" ? (body.statusCounts as Record<string, number>) : null);
        setCanRecordDismissal(body.viewer?.canRecordDismissal === true);
      } else {
        setRecords([]);
        setLoadError(
          res.status === 403
            ? "You do not have access to coaching records."
            : (typeof body?.error === "string" && body.error) || "Coaching records could not be loaded.",
        );
      }
    } catch {
      if (controller.signal.aborted) return;
      setRecords([]);
      setLoadError("Coaching records could not be loaded.");
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }, [cleanerId, type, status]);

  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => () => loadController.current?.abort(), []);

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/admin/users?role=CLEANER", { cache: "no-store", signal: controller.signal })
      .then(async (r) => {
        if (!r.ok) throw new Error("cleaners unavailable");
        return r.json();
      })
      .then((data: unknown) => {
        if (controller.signal.aborted) return;
        setCleaners(toCleanerOptions(data));
        setCleanersError(false);
      })
      .catch(() => {
        if (!controller.signal.aborted) setCleanersError(true);
      });
    return () => controller.abort();
  }, []);

  const activeFilters = Number(Boolean(cleanerId)) + Number(Boolean(type));

  function clearFilters() {
    setCleanerId("");
    setType("");
  }

  return (
    <div className="space-y-4">
      {/* Status chips with the server's grouped totals, then the cleaner and type filters. */}
      <div className="flex flex-wrap items-center gap-2">
        <EFilterChips<string>
          label="Coaching status"
          phoneLayout="carousel"
          active={status}
          onChange={setStatus}
          chips={[
            ...STATUSES.map((value) => ({ key: value, label: titleCase(value), count: statusCounts ? statusCounts[value] ?? 0 : undefined })),
            { key: "", label: "All", count: statusCounts ? Object.values(statusCounts).reduce((sum, value) => sum + value, 0) : undefined },
          ]}
        />
        <div className="ml-auto flex flex-wrap items-center gap-2">
          {canManage ? (
            <EButton size="sm" onClick={() => setCreating(true)} disabled={cleanersError}>
              <Plus className="h-3.5 w-3.5" />
              New record…
            </EButton>
          ) : null}
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <select aria-label="Cleaner" className={FIELD_CLS} value={cleanerId} onChange={(e) => setCleanerId(e.target.value)}>
          <option value="">All cleaners</option>
          {cleaners.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        <select aria-label="Type" className={FIELD_CLS} value={type} onChange={(e) => setType(e.target.value)}>
          <option value="">All types</option>
          {TYPES.map((t) => (
            <option key={t} value={t}>
              {titleCase(t)}
            </option>
          ))}
        </select>
        {activeFilters > 0 ? (
          <button type="button" onClick={clearFilters} className="min-h-9 text-[0.75rem] underline underline-offset-2 text-[hsl(var(--e-muted-foreground))]">
            Clear filters ({activeFilters})
          </button>
        ) : null}
        <span className="ml-auto text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
          {records.length} record{records.length === 1 ? "" : "s"}
        </span>
        <EButton variant="ghost" size="sm" onClick={load} disabled={loading}>
          <RefreshCw className={"h-3.5 w-3.5" + (loading ? " animate-spin" : "")} />
          Refresh
        </EButton>
      </div>

      {cleanersError ? (
        <EAlert tone="warning" title="The cleaner list could not be loaded">
          Filtering by cleaner{canManage ? " and creating a record" : ""} are unavailable until it loads. Reload the page to try again.
        </EAlert>
      ) : null}

      <div className="min-w-0 lg:flex lg:items-start lg:gap-4">
        <div className="min-w-0 flex-1">
          {loadError ? (
            <EAlert tone="danger" title={loadError}>
              <EButton variant="outline" size="sm" className="mt-2" onClick={() => void load()} disabled={loading}>
                Try again
              </EButton>
            </EAlert>
          ) : loading && records.length === 0 ? (
            <ECard role="status" className="px-6 py-16 text-center text-[0.875rem] text-[hsl(var(--e-muted-foreground))]">
              Gathering records…
            </ECard>
          ) : records.length === 0 ? (
            <EEmptyState
              eyebrow="None here"
              title="No coaching records"
              description="Records are created by managers when a cleaner needs coaching, a warning, or a management review."
            />
          ) : (
            <ECard className="overflow-hidden p-0">
              <div role="region" aria-label="Coaching records" tabIndex={0} className="overflow-x-auto max-sm:hidden">
                <table className="w-full min-w-[620px] text-left text-[0.8125rem]">
                  <thead>
                    <tr className="border-b border-[hsl(var(--e-border))] text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
                      <th className="px-4 py-2.5 font-[550]">Cleaner · reason</th>
                      <th className="px-4 py-2.5 font-[550]">Type</th>
                      <th className="px-4 py-2.5 font-[550]">Status</th>
                      <th className="px-4 py-2.5 font-[550]">Review</th>
                    </tr>
                  </thead>
                  <tbody>
                    {records.map((r) => {
                      const waiting = waitingWords(r);
                      return (
                        <tr key={r.id} className={"border-b border-[hsl(var(--e-border))] last:border-0 " + (selected?.id === r.id ? "bg-[hsl(var(--e-primary-soft))]" : "")}>
                          <td className={"px-4 py-2.5 " + (waiting ? toneRowCellClass("attention") : "")}>
                            <button type="button" onClick={() => setSelected(r)} className="block w-full text-left">
                              <span className="flex flex-wrap items-center gap-1.5 font-[600]">
                                {r.cleaner?.name ?? "Cleaner not recorded"}
                                {waiting ? <ETonePill tone="attention">{waiting}</ETonePill> : null}
                              </span>
                              <span className="line-clamp-1 text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
                                {r.reason}
                                {r.retrainingRequired ? " · retraining" : ""}
                              </span>
                            </button>
                          </td>
                          <td className="px-4 py-2.5"><EBadge tone={typeTone(r.type)} soft>{titleCase(r.type)}</EBadge></td>
                          <td className="px-4 py-2.5"><EBadge tone={statusTone(r.status)} soft>{titleCase(r.status)}</EBadge></td>
                          <td className="px-4 py-2.5 e-tnum text-[hsl(var(--e-text-secondary))]">{fmt(r.reviewDate)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <ul className="divide-y divide-[hsl(var(--e-border))] sm:hidden">
                {records.map((r) => {
                  const waiting = waitingWords(r);
                  return (
                    <li key={r.id}>
                      <button type="button" onClick={() => setSelected(r)} className="block w-full text-left">
                        <span className={"flex items-start justify-between gap-2 px-3.5 py-2.5 " + (waiting ? tonePhoneBandClass("attention") : "")}>
                          <span className="min-w-0">
                            <span className="block font-[600]">{r.cleaner?.name ?? "Cleaner not recorded"}</span>
                            <span className="line-clamp-2 text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">{r.reason}</span>
                          </span>
                          {waiting ? <ETonePill tone="attention" className="shrink-0">{waiting}</ETonePill> : <span className="shrink-0 text-[0.75rem] font-[550]">{titleCase(r.status)}</span>}
                        </span>
                        <span className="block px-3.5 pb-2.5 text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">{titleCase(r.type)} · review {fmt(r.reviewDate)}</span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </ECard>
          )}
        </div>

        {selected ? (
          <RecordPanel
            key={selected.id}
            record={selected}
            canManage={canManage}
            canRecordDismissal={canRecordDismissal}
            onClose={() => setSelected(null)}
            onChanged={async () => {
              await load();
              setSelected(null);
            }}
          />
        ) : null}
      </div>

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
    </div>
  );
}

/** "Not acknowledged, 5 days" for an open warning or review the cleaner has not acknowledged. */
function waitingWords(record: Record_): string | null {
  if (record.status !== "OPEN" || record.acknowledgedAt) return null;
  const created = Date.parse(record.createdAt);
  if (Number.isNaN(created)) return "Not acknowledged";
  const days = Math.floor((Date.now() - created) / 86_400_000);
  return days >= 1 ? `Not acknowledged, ${days} day${days === 1 ? "" : "s"}` : "Not acknowledged";
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

/* ── Detail panel with status / outcome controls ───────────────────────── */
function RecordPanel({
  record,
  canManage,
  canRecordDismissal,
  onClose,
  onChanged,
}: {
  record: Record_;
  canManage: boolean;
  canRecordDismissal: boolean;
  onClose: () => void;
  onChanged: () => void | Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string>(record.status ?? "OPEN");
  const [outcome, setOutcome] = useState<string>(record.outcome ?? "NONE");
  const [retraining, setRetraining] = useState<boolean>(Boolean(record.retrainingRequired));
  const [notes, setNotes] = useState<string>(record.notes ?? "");
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [confirmError, setConfirmError] = useState<string | null>(null);

  const issueIds: string[] = useMemo(() => {
    const raw = record.issueIds;
    return Array.isArray(raw) ? raw.filter((x: any) => typeof x === "string") : [];
  }, [record]);

  const recordsDismissal = isDismissalOutcome(outcome) && outcome !== (record.outcome ?? "NONE");

  async function save(security?: SensitiveCredentialsInput): Promise<boolean> {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/accountability/coaching/${record.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          status,
          outcome,
          retrainingRequired: retraining,
          notes: notes.trim() || null,
          ...(security ? { security } : {}),
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        const message = `Not saved: ${sensitiveVerificationText(json.error) || "try again."}`;
        if (security) setConfirmError(message);
        else setError(message);
        return false;
      }
      toast({ title: "Record updated" });
      await onChanged();
      return true;
    } catch {
      const message = "Not saved: the connection failed.";
      if (security) setConfirmError(message);
      else setError(message);
      return false;
    } finally {
      setBusy(false);
    }
  }

  function requestSave() {
    if (recordsDismissal) {
      setConfirmError(null);
      setConfirming(true);
      return;
    }
    void save();
  }

  return (
    <ESidePanel
      open
      label="Coaching record"
      title={`${titleCase(record.type)} · ${record.cleaner?.name ?? "Cleaner not recorded"}`}
      subtitle={<span className="line-clamp-2">{record.reason}</span>}
      toolbar={<EBadge tone={statusTone(record.status)} soft>{titleCase(record.status)}</EBadge>}
      onClose={onClose}
    >
      <div className="space-y-4">
        <dl className="grid grid-cols-[7rem_minmax(0,1fr)] gap-x-3 gap-y-1.5 text-[0.8125rem]">
          <dt className="text-[hsl(var(--e-muted-foreground))]">Raised</dt>
          <dd>{record.createdBy?.name ?? "Not recorded"} · {fmt(record.createdAt)}</dd>
          {record.patternKey ? (<><dt className="text-[hsl(var(--e-muted-foreground))]">Pattern</dt><dd className="[overflow-wrap:anywhere]">{record.patternKey}</dd></>) : null}
          <dt className="text-[hsl(var(--e-muted-foreground))]">Review date</dt>
          <dd>{fmt(record.reviewDate)}</dd>
          <dt className="text-[hsl(var(--e-muted-foreground))]">Acknowledged</dt>
          <dd>{record.acknowledgedAt ? fmt(record.acknowledgedAt) : "Not yet"}</dd>
        </dl>

        <div>
          <EEyebrow className="mb-1">Reason (the cleaner sees this)</EEyebrow>
          <p className="whitespace-pre-wrap text-[0.875rem] text-[hsl(var(--e-text-secondary))]">&ldquo;{record.reason}&rdquo;</p>
        </div>

        {issueIds.length > 0 ? (
          <EButton variant="outline-gold" size="sm" asChild>
            <Link href="/v2/admin/quality/issues">
              View linked issues ({issueIds.length}) <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </EButton>
        ) : null}

        {canManage ? (
          <fieldset disabled={busy} className="space-y-3 border-t border-[hsl(var(--e-border))] pt-4">
            <ChipGroup label="Status" value={status} options={STATUSES.map((value) => ({ value, label: titleCase(value) }))} onChange={setStatus} />
            <ChipGroup
              label="Outcome"
              value={outcome}
              options={OUTCOMES.map((value) => ({
                value,
                label: value === "NONE" ? "None yet" : titleCase(value),
                disabled: isDismissalOutcome(value) && !canRecordDismissal && value !== record.outcome,
              }))}
              onChange={setOutcome}
            />
            <p className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
              {canRecordDismissal
                ? "Suspended and Terminated ask for your PIN; they do not change the login on their own, that stays in Accounts."
                : "Only an administrator can record Suspended or Terminated."}
            </p>
            <ESwitch checked={retraining} onCheckedChange={setRetraining} label="Retraining required" />
            <EField label="Internal notes for managers only">
              <ETextarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Notes (optional)…" />
            </EField>
            {error ? <p role="alert" className="text-[0.8125rem] font-[550] text-[hsl(var(--e-danger))]">{error}</p> : null}
            <div className="flex flex-wrap gap-2">
              <EButton size="sm" onClick={requestSave}>{busy ? "Saving…" : "Save changes"}</EButton>
              <EButton variant="ghost" size="sm" onClick={onClose}>Cancel</EButton>
            </div>
          </fieldset>
        ) : null}
      </div>

      <EConfirmDialog
        open={confirming}
        tier="sensitive"
        title={`Record ${titleCase(outcome)} for ${record.cleaner?.name ?? "this cleaner"}?`}
        description="This records the outcome on the coaching record. It does not change their login; that stays in Accounts."
        confirmLabel={`Record ${titleCase(outcome).toLowerCase()}`}
        busy={busy}
        error={confirmError}
        onClose={() => { if (!busy) setConfirming(false); }}
        onConfirm={async ({ credentials }) => {
          if (!credentials) return;
          const ok = await save(credentials);
          if (ok) setConfirming(false);
        }}
      />
    </ESidePanel>
  );
}

function ChipGroup({ label, value, options, onChange }: {
  label: string;
  value: string;
  options: Array<{ value: string; label: string; disabled?: boolean }>;
  onChange: (value: string) => void;
}) {
  return (
    <div>
      <p className="mb-1 text-[0.8125rem] font-[550]">{label}</p>
      <div role="radiogroup" aria-label={label} className="flex flex-wrap gap-1.5">
        {options.map((option) => (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={value === option.value}
            disabled={option.disabled}
            onClick={() => onChange(option.value)}
            className={
              "min-h-9 rounded-full border px-3 text-[0.8125rem] max-sm:min-h-11 disabled:cursor-not-allowed disabled:opacity-50 " +
              (value === option.value
                ? "border-[hsl(var(--e-primary)/0.35)] bg-[hsl(var(--e-primary-soft))] font-[600] text-[hsl(var(--e-primary))]"
                : "border-[hsl(var(--e-border-strong))]")
            }
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function toCleanerOptions(data: unknown): CleanerOption[] {
  const list: unknown[] = Array.isArray(data)
    ? data
    : Array.isArray((data as { users?: unknown } | null)?.users)
      ? (data as { users: unknown[] }).users
      : [];
  return list
    .map((item) => item as { id?: unknown; name?: unknown; email?: unknown })
    .filter((user): user is { id: string; name?: unknown; email?: unknown } => typeof user.id === "string")
    .map((user) => ({
      id: user.id,
      name: typeof user.name === "string" && user.name ? user.name : typeof user.email === "string" ? user.email : "Cleaner",
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

function Fact({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <p className="text-[0.625rem] uppercase tracking-[0.08em] text-[hsl(var(--e-text-faint))]">{label}</p>
      <p className="text-[0.875rem] text-[hsl(var(--e-foreground))]">{value}</p>
    </div>
  );
}
