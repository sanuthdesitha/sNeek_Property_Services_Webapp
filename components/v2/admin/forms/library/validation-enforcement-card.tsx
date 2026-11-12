"use client";

/**
 * Results and stats tab: the switch "Reject submissions that break these
 * checks" with the checks it covers and the real counts to decide by
 * (submissions with warnings in the last 14 and 30 days, by check and by form,
 * the latest ones to open). "–" when the counts could not be read; "0" only
 * when the database says zero. ADMIN changes it; others read it.
 */
import * as React from "react";
import Link from "next/link";
import { EButton, ECard } from "@/components/v2/ui/primitives";
import { EPill } from "@/components/v2/ui/pill";
import type { FormValidationSettings } from "@/lib/forms/validation-enforcement";
import type { ValidationWarningStats } from "@/lib/forms/validation-warning-stats";

export const RULE_LABEL: Record<string, string> = {
  range: "Numbers within the set range",
  email: "Email addresses that look valid",
  details: "Details written when the answer is No",
  "number-format": "A number where a number is asked",
  phone: "Phone numbers that look valid",
  date: "Real dates and times",
  option: "Choices from the listed options",
  "scale-range": "Ratings and scales within their range",
  "max-files": "No more files than allowed",
};

type Payload = { setting: FormValidationSettings; rules: string[]; stats: ValidationWarningStats | null; statsError: string | null };

function count(stats: ValidationWarningStats | null, pick: (stats: ValidationWarningStats) => number): string {
  return stats ? pick(stats).toLocaleString("en-AU") : "–";
}

export function ValidationEnforcementCard({ canWrite, timezone }: { canWrite: boolean; timezone: string }) {
  const [payload, setPayload] = React.useState<Payload | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [saving, setSaving] = React.useState(false);
  const [confirming, setConfirming] = React.useState(false);

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
      setError(cause instanceof Error ? cause.message : "Not saved.");
    } finally {
      setSaving(false);
    }
  }

  const setting = payload?.setting;
  const stats = payload?.stats ?? null;
  const since = setting?.enforcedSince
    ? new Intl.DateTimeFormat("en-AU", { timeZone: timezone, day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(setting.enforcedSince))
    : null;

  return (
    <ECard className="space-y-3 p-4" role="region" aria-labelledby="validation-enforcement-heading">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 id="validation-enforcement-heading" className="text-[0.9375rem] font-[600]">Reject submissions that break these checks</h3>
        {setting ? <EPill tone={setting.enforceExtended ? "warn" : "neutral"}>{setting.enforceExtended ? `On since ${since}` : "Off: recorded as warnings"}</EPill> : null}
      </div>
      <ul className="grid gap-x-4 gap-y-0.5 text-[0.8125rem] text-[hsl(var(--e-text-secondary))] sm:grid-cols-2">
        {(payload?.rules ?? Object.keys(RULE_LABEL)).map((rule) => <li key={rule}>· {RULE_LABEL[rule] ?? rule}</li>)}
      </ul>
      <p className="text-[0.8125rem] text-[hsl(var(--e-text-secondary))]">
        Off: a submission that breaks one is accepted and the problem is recorded on it. On: the cleaner&apos;s phone shows these checks and the
        server refuses the submission until they are fixed. Jobs a cleaner started before it was switched on are still accepted with warnings.
      </p>
      {error ? <p role="alert" className="text-[0.8125rem] text-[hsl(var(--e-danger))]">{error}</p> : null}

      <div className="overflow-x-auto">
        <table className="w-full min-w-[22rem] text-left text-[0.8125rem]">
          <caption className="sr-only">Submissions with warnings</caption>
          <thead>
            <tr className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
              <th scope="col" className="py-1 font-[550]">Submissions</th>
              <th scope="col" className="py-1 text-right font-[550]">Last 14 days</th>
              <th scope="col" className="py-1 text-right font-[550]">Last 30 days</th>
            </tr>
          </thead>
          <tbody className="e-tnum">
            <tr>
              <th scope="row" className="py-1 font-[550]">With warnings</th>
              <td className="text-right">{count(stats, (s) => s.withWarnings.d14)}</td>
              <td className="text-right">{count(stats, (s) => s.withWarnings.d30)}</td>
            </tr>
            <tr className="text-[hsl(var(--e-text-faint))]">
              <th scope="row" className="py-1 font-normal">All submissions</th>
              <td className="text-right">{count(stats, (s) => s.submissions.d14)}</td>
              <td className="text-right">{count(stats, (s) => s.submissions.d30)}</td>
            </tr>
            {(stats?.byRule ?? []).map((row) => (
              <tr key={row.rule}>
                <th scope="row" className="py-1 pl-3 font-normal">{RULE_LABEL[row.rule] ?? row.rule}</th>
                <td className="text-right">{row.d14.toLocaleString("en-AU")}</td>
                <td className="text-right">{row.d30.toLocaleString("en-AU")}</td>
              </tr>
            ))}
            {(stats?.byForm ?? []).map((row) => (
              <tr key={row.templateId}>
                <th scope="row" className="py-1 pl-3 font-normal">
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
      {stats && stats.recent.length > 0 ? (
        <details className="text-[0.8125rem]">
          <summary className="cursor-pointer font-[550]">Latest submissions with warnings ({stats.recent.length})</summary>
          <ul className="mt-1 space-y-1">
            {stats.recent.map((row) => (
              <li key={row.submissionId}>
                <Link href={`/v2/admin/jobs/${row.jobId}`} className="font-[550] text-[hsl(var(--e-primary))] hover:underline">{row.formName}</Link>{" "}
                <span className="text-[hsl(var(--e-text-faint))]">
                  {new Intl.DateTimeFormat("en-AU", { timeZone: timezone, day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }).format(new Date(row.createdAt))} ·{" "}
                  {row.rules.map((rule) => RULE_LABEL[rule] ?? rule).join(", ")}
                </span>
              </li>
            ))}
          </ul>
        </details>
      ) : null}

      {canWrite && setting ? (
        confirming ? (
          <div className="flex flex-wrap items-center gap-2 rounded-[var(--e-radius)] border border-[hsl(var(--e-warning))] p-3 text-[0.8125rem]">
            <span className="min-w-0 flex-1">
              {setting.enforceExtended
                ? "Stop rejecting? Submissions that break these checks will be accepted again and recorded as warnings."
                : "Start rejecting from now? Cleaners will see these checks and must fix them before submitting. Jobs already started are not affected."}
            </span>
            <EButton size="sm" disabled={saving} onClick={() => void change(!setting.enforceExtended)}>{saving ? "Saving…" : "Confirm"}</EButton>
            <EButton size="sm" variant="ghost" disabled={saving} onClick={() => setConfirming(false)}>Cancel</EButton>
          </div>
        ) : (
          <EButton size="sm" variant="outline" onClick={() => setConfirming(true)}>
            {setting.enforceExtended ? "Stop rejecting (record as warnings)" : "Start rejecting submissions that break these checks"}
          </EButton>
        )
      ) : null}
    </ECard>
  );
}
