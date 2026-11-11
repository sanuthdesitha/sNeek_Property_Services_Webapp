"use client";

/**
 * ESTATE-native "cleaner invoice PREDICTION" surface.
 *
 * Predicts what each ACTIVE cleaner will invoice for a pay period BEFORE they
 * submit, so admin can (a) see the money to prepare for payday and (b) review
 * each expected invoice for transparency (overridden hours, pending vs approved
 * extras, missing rates). Once a cleaner submits, it reconciles submitted-vs-
 * expected (variance + jobs they forgot to add).
 *
 * Read-only. Data comes ENTIRELY from the existing endpoint:
 *   GET /api/admin/cleaner-invoices/expected?start=YYYY-MM-DD&end=YYYY-MM-DD
 * (optional &cleanerId=). Response shape = ExpectedInvoicesResult from
 * lib/cleaner/expected-invoice.ts. No API/lib changes.
 */
import * as React from "react";
import { Loader2, RefreshCw, Clock, Wallet, Users, GitCompareArrows } from "lucide-react";
import { EAlert, EButton, ECard, ECardBody, EEmptyState, EStatCard } from "@/components/v2/ui/primitives";
import { EField, EInput } from "@/components/v2/admin/estate-kit";
import { CleanerCard } from "./expected-invoice-cards";
import {
  PRESETS,
  fmtDate,
  money,
  presetRange,
  varianceOff,
  type ExpectedResult,
  type PresetKey,
} from "./expected-invoice-model";

/* ── Panel ─────────────────────────────────────────────────────────────── */
export function ExpectedInvoicesPanel() {
  const initial = React.useMemo(() => presetRange("thisMonth"), []);
  // `range` = the applied window that drives fetches; the inputs edit a draft.
  const [range, setRange] = React.useState({ start: initial.start, end: initial.end });
  const [draftStart, setDraftStart] = React.useState(initial.start);
  const [draftEnd, setDraftEnd] = React.useState(initial.end);

  const [data, setData] = React.useState<ExpectedResult | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [expanded, setExpanded] = React.useState<Record<string, boolean>>({});

  const activePreset = React.useMemo<PresetKey | null>(() => {
    for (const p of PRESETS) {
      const r = presetRange(p.key);
      if (r.start === range.start && r.end === range.end) return p.key;
    }
    return null;
  }, [range]);

  const load = React.useCallback(async (start: string, end: string) => {
    setLoading(true);
    setError(null);
    try {
      const qs = new URLSearchParams({ start, end });
      const res = await fetch(`/api/admin/cleaner-invoices/expected?${qs.toString()}`, {
        cache: "no-store",
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body?.error || "Could not compute expected invoices.");
        setData(null);
        return;
      }
      setData(body as ExpectedResult);
    } catch (e: any) {
      setError(e?.message || "Network error while loading the prediction.");
      setData(null);
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    load(range.start, range.end);
  }, [range, load]);

  function applyPreset(key: PresetKey) {
    const r = presetRange(key);
    setDraftStart(r.start);
    setDraftEnd(r.end);
    setRange(r);
  }
  function applyDraft() {
    if (!draftStart || !draftEnd) return;
    // Guard against inverted ranges — swap so the fetch is always start ≤ end.
    const [s, e] = draftStart <= draftEnd ? [draftStart, draftEnd] : [draftEnd, draftStart];
    setDraftStart(s);
    setDraftEnd(e);
    setRange({ start: s, end: e });
  }

  const cleaners = data?.cleaners ?? [];

  // Count of cleaners whose submission is materially off OR who forgot jobs.
  const flaggedReconciliations = React.useMemo(
    () =>
      cleaners.filter(
        (c) =>
          c.submission &&
          (varianceOff(c.submission.variance) || c.submission.missingJobs.length > 0)
      ).length,
    [cleaners]
  );

  function toggle(id: string) {
    setExpanded((m) => ({ ...m, [id]: !m[id] }));
  }

  return (
    <div className="space-y-6">
      {/* ── Period selector ───────────────────────────────────────────── */}
      <ECard>
        <ECardBody className="space-y-4 p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap gap-1.5">
              {PRESETS.map((p) => {
                const active = activePreset === p.key;
                return (
                  <button
                    key={p.key}
                    type="button"
                    onClick={() => applyPreset(p.key)}
                    className={`rounded-[var(--e-radius-pill)] px-3 py-1 text-[0.75rem] font-medium transition-colors ${
                      active
                        ? "bg-[hsl(var(--e-foreground))] text-[hsl(var(--e-background))]"
                        : "border border-[hsl(var(--e-border))] text-[hsl(var(--e-muted-foreground))] hover:bg-[hsl(var(--e-muted))]"
                    }`}
                  >
                    {p.label}
                  </button>
                );
              })}
            </div>
            <EButton variant="outline" size="sm" onClick={() => load(range.start, range.end)} disabled={loading}>
              <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} /> Refresh
            </EButton>
          </div>

          <div className="flex flex-wrap items-end gap-3">
            <EField label="From" className="w-full sm:w-auto">
              <EInput
                type="date"
                value={draftStart}
                max={draftEnd || undefined}
                onChange={(e) => setDraftStart(e.target.value)}
                className="sm:w-[10.5rem]"
              />
            </EField>
            <EField label="To" className="w-full sm:w-auto">
              <EInput
                type="date"
                value={draftEnd}
                min={draftStart || undefined}
                onChange={(e) => setDraftEnd(e.target.value)}
                className="sm:w-[10.5rem]"
              />
            </EField>
            <EButton variant="gold" size="md" onClick={applyDraft} disabled={loading || !draftStart || !draftEnd}>
              Apply
            </EButton>
          </div>

          <p className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
            Predicting the window{" "}
            <span className="font-medium text-[hsl(var(--e-foreground))]">
              {fmtDate(data?.start ?? range.start)} → {fmtDate(data?.end ?? range.end)}
            </span>
            . Only unpaid jobs count, so this is money genuinely upcoming.
          </p>
        </ECardBody>
      </ECard>

      {/* ── Summary strip ─────────────────────────────────────────────── */}
      <section className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <EStatCard
          label="Money to prepare"
          value={money(data?.grandExpectedTotal)}
          icon={<Wallet className="h-4 w-4" />}
        />
        <EStatCard
          label="Pending (unapproved) extras"
          value={money(data?.grandPendingAmount)}
          delta={data && data.grandPendingAmount > 0 ? "Awaiting approval — not in total" : undefined}
          deltaTone="neutral"
          icon={<Clock className="h-4 w-4" />}
        />
        <EStatCard
          label="Cleaners with activity"
          value={cleaners.length}
          icon={<Users className="h-4 w-4" />}
        />
        <EStatCard
          label="Reconciliations to review"
          value={flaggedReconciliations}
          delta={flaggedReconciliations > 0 ? "Submitted totals differ from expected" : undefined}
          deltaTone={flaggedReconciliations > 0 ? "danger" : "neutral"}
          icon={<GitCompareArrows className="h-4 w-4" />}
        />
      </section>

      {/* ── States ────────────────────────────────────────────────────── */}
      {error ? (
        <EAlert tone="danger" title="Couldn't load the prediction">
          <div className="flex items-center justify-between gap-3">
            <span>{error}</span>
            <EButton variant="outline" size="sm" onClick={() => load(range.start, range.end)}>
              <RefreshCw className="h-3.5 w-3.5" /> Retry
            </EButton>
          </div>
        </EAlert>
      ) : loading && !data ? (
        <ECard>
          <ECardBody className="flex items-center gap-2 py-10 text-[0.875rem] text-[hsl(var(--e-muted-foreground))]">
            <Loader2 className="h-4 w-4 animate-spin" /> Predicting cleaner invoices…
          </ECardBody>
        </ECard>
      ) : cleaners.length === 0 ? (
        <EEmptyState
          eyebrow="Predicted invoices"
          title="No expected invoices in this window"
          description="No active cleaner has unpaid jobs, expenses or pending extras for the selected period. Try a wider range or a different month."
        />
      ) : (
        <div className="space-y-4">
          {loading ? (
            <p className="flex items-center gap-2 text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> Refreshing…
            </p>
          ) : null}
          {cleaners.map((c) => (
            <CleanerCard
              key={c.cleanerId}
              cleaner={c}
              open={!!expanded[c.cleanerId]}
              onToggle={() => toggle(c.cleanerId)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
