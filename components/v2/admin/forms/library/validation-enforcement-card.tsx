"use client";

/**
 * Results and stats tab: the ONE switch "Reject submissions that break these
 * checks" (every form, not per form; owner default 2026-11-17), the checks it
 * covers and the real counts to decide by (submissions with warnings in the
 * last 14 and 30 days, by check and by form, the latest ones to open). "–"
 * when the counts could not be read; "0" only when the database says zero.
 * ADMIN changes it; others read it.
 *
 * Board "Forms: results and stats": the button reads "Start rejecting…" (it
 * used to be the whole sentence on one line, wider than a phone) and the full
 * sentence is the title of a tier A confirmation. On a phone the card shows a
 * summary (two counts and the most common check) with "See all" for the list.
 */
import * as React from "react";
import Link from "next/link";
import { EButton, ECard } from "@/components/v2/ui/primitives";
import { EPill } from "@/components/v2/ui/pill";
import { EConfirmDialog } from "@/components/v2/ui/confirm-dialog";
import type { FormValidationSettings } from "@/lib/forms/validation-enforcement";
import type { ValidationWarningStats } from "@/lib/forms/validation-warning-stats";
import { VALIDATION_RULE_LABEL } from "./validation-rule-labels";

type Payload = { setting: FormValidationSettings; rules: string[]; stats: ValidationWarningStats | null; statsError: string | null };

function count(stats: ValidationWarningStats | null, pick: (stats: ValidationWarningStats) => number): string {
  return stats ? pick(stats).toLocaleString("en-AU") : "–";
}

function ruleLabel(rule: string): string {
  return VALIDATION_RULE_LABEL[rule] ?? rule;
}

export function ValidationEnforcementCard({ canWrite, timezone }: { canWrite: boolean; timezone: string }) {
  const [payload, setPayload] = React.useState<Payload | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [saveError, setSaveError] = React.useState<string | null>(null);
  const [saving, setSaving] = React.useState(false);
  const [confirming, setConfirming] = React.useState(false);
  const [rulesOpen, setRulesOpen] = React.useState(false);
  const rulesId = React.useId();

  const load = React.useCallback((signal?: AbortSignal) => {
    fetch("/api/admin/form-templates/validation-setting", { cache: "no-store", signal })
      .then(async (response) => {
        const body: unknown = await response.json().catch(() => null);
        if (signal?.aborted) return;
        if (!response.ok || !body || typeof body !== "object") throw new Error((body as { error?: string } | null)?.error ?? `Could not load (${response.status}).`);
        setPayload(body as Payload);
        setError(null);
      })
      .catch((cause: unknown) => {
        if (!signal?.aborted) setError(cause instanceof Error ? cause.message : "Could not load the setting.");
      });
  }, []);

  React.useEffect(() => {
    const controller = new AbortController();
    load(controller.signal);
    return () => controller.abort();
  }, [load]);

  async function change(enforce: boolean) {
    setSaving(true);
    setSaveError(null);
    try {
      const response = await fetch("/api/admin/form-templates/validation-setting", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ enforce }),
      });
      const body = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) throw new Error(body.error ?? `Not saved (${response.status}).`);
      setConfirming(false);
      load();
    } catch (cause) {
      setSaveError(`It was not changed: ${cause instanceof Error ? cause.message : "the server did not answer."}`);
    } finally {
      setSaving(false);
    }
  }

  const setting = payload?.setting;
  const stats = payload?.stats ?? null;
  const rules = payload?.rules ?? Object.keys(VALIDATION_RULE_LABEL);
  const enforcing = setting?.enforceExtended === true;
  const since = setting?.enforcedSince
    ? new Intl.DateTimeFormat("en-AU", { timeZone: timezone, day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(setting.enforcedSince))
    : null;
  const topRule = stats?.byRule.slice().sort((a, b) => b.d14 - a.d14)[0] ?? null;
  const formatter = new Intl.DateTimeFormat("en-AU", { timeZone: timezone, day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });

  return (
    <ECard className="min-w-0 space-y-3 p-4" role="region" aria-labelledby="validation-enforcement-heading">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 id="validation-enforcement-heading" className="text-[0.9375rem] font-[600]">Reject submissions that break these checks</h3>
          <p className="text-[0.75rem] text-[hsl(var(--e-text-secondary))] max-sm:hidden">Applies to every form. Administrators change it; others read it.</p>
        </div>
        {setting ? <EPill tone={enforcing ? "warn" : "neutral"}>{enforcing ? `On since ${since}` : "Off: recorded as warnings"}</EPill> : null}
      </div>

      {/* Phone summary: the list is behind "See all". */}
      <p className="text-[0.8125rem] text-[hsl(var(--e-text-secondary))] sm:hidden">
        {rules.length} checks: {rules.map((rule) => ruleLabel(rule).toLowerCase()).join(", ")}.{" "}
        <button type="button" className="font-[600] underline" aria-expanded={rulesOpen} aria-controls={rulesId} onClick={() => setRulesOpen((open) => !open)}>
          {rulesOpen ? "Hide" : "See all"}
        </button>
      </p>
      <ul id={rulesId} className={`grid list-disc gap-x-6 gap-y-0.5 pl-5 text-[0.8125rem] text-[hsl(var(--e-text-secondary))] sm:grid-cols-2 ${rulesOpen ? "" : "max-sm:hidden"}`}>
        {rules.map((rule) => <li key={rule}>{ruleLabel(rule)}</li>)}
      </ul>
      {error ? <p role="alert" className="text-[0.8125rem] text-[hsl(var(--e-danger))]">{error}</p> : null}

      <div className="grid grid-cols-2 gap-2 sm:hidden">
        <div className="rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] p-2.5">
          <p className="e-tnum text-[1.125rem] font-[600]">{count(stats, (s) => s.withWarnings.d14)}</p>
          <p className="text-[0.75rem] text-[hsl(var(--e-text-secondary))]">with warnings, 14 days</p>
        </div>
        <div className="rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] p-2.5">
          <p className="e-tnum text-[1.125rem] font-[600]">{count(stats, (s) => s.withWarnings.d30)}</p>
          <p className="text-[0.75rem] text-[hsl(var(--e-text-secondary))]">with warnings, 30 days</p>
        </div>
        <p className="col-span-2 text-[0.75rem] text-[hsl(var(--e-text-secondary))]">
          Of {count(stats, (s) => s.submissions.d14)} and {count(stats, (s) => s.submissions.d30)} submissions.
          {topRule && topRule.d14 > 0 ? ` Most: "${ruleLabel(topRule.rule)}" (${topRule.d14.toLocaleString("en-AU")}).` : ""}
        </p>
      </div>

      <div className="overflow-x-auto max-sm:hidden">
        <table className="w-full min-w-[22rem] text-left text-[0.8125rem]">
          <caption className="sr-only">Submissions with warnings</caption>
          <thead>
            <tr className="border-b border-[hsl(var(--e-border))] text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
              <th scope="col" className="py-1.5 font-[550]">Submissions</th>
              <th scope="col" className="py-1.5 text-right font-[550]">Last 14 days</th>
              <th scope="col" className="py-1.5 text-right font-[550]">Last 30 days</th>
            </tr>
          </thead>
          <tbody className="e-tnum divide-y divide-[hsl(var(--e-border))]">
            <tr>
              <th scope="row" className="py-1.5 font-[600]">With warnings</th>
              <td className="text-right font-[600]">{count(stats, (s) => s.withWarnings.d14)}</td>
              <td className="text-right font-[600]">{count(stats, (s) => s.withWarnings.d30)}</td>
            </tr>
            <tr className="text-[hsl(var(--e-text-secondary))]">
              <th scope="row" className="py-1.5 font-normal">All submissions</th>
              <td className="text-right">{count(stats, (s) => s.submissions.d14)}</td>
              <td className="text-right">{count(stats, (s) => s.submissions.d30)}</td>
            </tr>
            {(stats?.byRule ?? []).map((row) => (
              <tr key={row.rule}>
                <th scope="row" className="py-1.5 pl-3 font-normal">{ruleLabel(row.rule)}</th>
                <td className="text-right">{row.d14.toLocaleString("en-AU")}</td>
                <td className="text-right">{row.d30.toLocaleString("en-AU")}</td>
              </tr>
            ))}
            {(stats?.byForm ?? []).map((row) => (
              <tr key={row.templateId}>
                <th scope="row" className="py-1.5 pl-3 font-normal">
                  <Link href={`/v2/admin/forms?tab=stats&templateId=${encodeURIComponent(row.templateId)}`} className="hover:underline">{row.name}</Link>
                </th>
                <td className="text-right">{row.d14.toLocaleString("en-AU")}</td>
                <td className="text-right">{row.d30.toLocaleString("en-AU")}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {payload?.statsError ? <p className="text-[0.75rem] text-[hsl(var(--e-danger))]">{payload.statsError}</p> : null}

      <div className="flex flex-wrap items-center justify-between gap-2">
        {stats && stats.recent.length > 0 ? (
          <details className="min-w-0 text-[0.8125rem]">
            <summary className="cursor-pointer font-[550] text-[hsl(var(--e-primary))] underline">Latest submissions with warnings ({stats.recent.length})</summary>
            <ul className="mt-1 space-y-1">
              {stats.recent.map((row) => (
                <li key={row.submissionId} className="break-words">
                  <Link href={`/v2/admin/jobs/${row.jobId}`} className="font-[550] text-[hsl(var(--e-primary))] hover:underline">{row.formName}</Link>{" "}
                  <span className="text-[hsl(var(--e-text-faint))]">
                    {formatter.format(new Date(row.createdAt))} · {row.rules.map(ruleLabel).join(", ")}
                  </span>
                </li>
              ))}
            </ul>
          </details>
        ) : <span />}
        {canWrite && setting ? (
          <EButton size="sm" variant="outline" className="max-sm:w-full" onClick={() => { setSaveError(null); setConfirming(true); }}>
            {enforcing ? "Stop rejecting…" : "Start rejecting…"}
          </EButton>
        ) : null}
      </div>
      {canWrite && setting ? <p className="text-[0.75rem] text-[hsl(var(--e-text-faint))] sm:hidden">Only administrators see this button.</p> : null}

      <EConfirmDialog
        open={confirming}
        onClose={() => { if (!saving) setConfirming(false); }}
        tier="ordinary"
        title={enforcing ? "Stop rejecting submissions that break these checks?" : "Start rejecting submissions that break these checks?"}
        description={
          enforcing
            ? "Submissions that break these checks will be accepted again and the problems recorded on them as warnings."
            : "From now on cleaners see these checks and must fix them before submitting. Jobs already started are still accepted with warnings."
        }
        confirmLabel={enforcing ? "Stop rejecting" : "Start rejecting"}
        busy={saving}
        error={saveError}
        onConfirm={() => change(!enforcing)}
      />
    </ECard>
  );
}
