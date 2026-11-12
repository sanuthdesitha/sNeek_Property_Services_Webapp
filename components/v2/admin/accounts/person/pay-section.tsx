"use client";

/**
 * The one Pay editor (Wave E, 2026-11): hourly rate + "Applies from", and the
 * rate history beneath it.
 *  Save            → PATCH  /api/admin/users/[id]/pay { hourlyRate, appliesFrom }  (ADMIN only)
 *  Remove a future → DELETE /api/admin/users/[id]/pay?entryId=…                     (ADMIN only)
 * Rates already in force are never edited or removed; jobs before the Applies
 * from day keep the rate in force on their day.
 */
import Link from "next/link";
import { useState } from "react";
import { EButton } from "@/components/v2/ui/primitives";
import { EPill } from "@/components/v2/ui/pill";
import { EField, EInput } from "@/components/v2/admin/estate-kit";
import type { PersonCapabilities, PersonProfile } from "@/lib/accounts/person-types";
import type { PayRateHistoryEntry } from "@/lib/accounts/pay-rate-history";
import { sydneyTodayKey } from "@/lib/time/sydney-range";
import { formatDateTime, formatRate } from "../hub/account-display";
import { EditableSection, FactList, ensureOk } from "./editable-section";
import { APPLIES_FROM_HELP, RATE_HELP, RATE_RECALC_NOTE, formatRateDay } from "./pay-copy";

type SectionProps = { profile: PersonProfile; caps: PersonCapabilities; onChanged: () => void };
type PayDraft = { rate: string; appliesFrom: string };

function nextScheduled(entries: PayRateHistoryEntry[]): PayRateHistoryEntry | null {
  const future = entries.filter((entry) => entry.state === "FUTURE");
  return future.length ? future[future.length - 1] : null;
}

export function PaySection({ profile, caps, onChanged }: SectionProps) {
  if (profile.role === "CLIENT" || profile.role === "VA") return null;
  const scheduled = profile.payRateHistory ? nextScheduled(profile.payRateHistory.entries) : null;
  return (
    <EditableSection<PayDraft>
      title="Pay"
      personId={profile.id}
      canEdit={caps.isAdmin}
      view={
        <div className="space-y-1">
          <FactList
            labelWidth={90}
            rows={[
              { label: "Hourly rate", value: <span className="e-tnum">{formatRate(profile.hourlyRate) ?? "Not set"}</span> },
              ...(scheduled ? [{ label: "Scheduled", value: <span className="e-tnum">{formatRate(scheduled.hourlyRate)} from {formatRateDay(scheduled.effectiveFrom)}</span> }] : []),
            ]}
          />
          <p className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">{RATE_RECALC_NOTE} A rate saved on a job (at assignment or by job type) takes priority over this one.</p>
        </div>
      }
      makeDraft={() => ({ rate: profile.hourlyRate === null ? "" : profile.hourlyRate.toFixed(2), appliesFrom: sydneyTodayKey() })}
      renderEdit={(draft, setDraft) => (
        <>
          <div className="grid gap-2.5 sm:grid-cols-2">
            <EField label="Hourly rate" hint={RATE_HELP}>
              <EInput inputMode="decimal" className="e-tnum" value={draft.rate} onChange={(e) => setDraft({ ...draft, rate: e.target.value })} />
            </EField>
            <EField label="Applies from" hint={APPLIES_FROM_HELP}>
              <EInput type="date" min={sydneyTodayKey()} value={draft.appliesFrom} onChange={(e) => setDraft({ ...draft, appliesFrom: e.target.value })} />
            </EField>
          </div>
          <p className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">{RATE_RECALC_NOTE}</p>
        </>
      )}
      save={async (draft) => {
        const value = Number(draft.rate);
        if (draft.rate.trim() === "" || !Number.isFinite(value)) throw new Error("Enter the hourly rate as a number.");
        if (!draft.appliesFrom) throw new Error("Choose the day the rate applies from.");
        const res = await fetch(`/api/admin/users/${profile.id}/pay`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ hourlyRate: value, appliesFrom: draft.appliesFrom }),
        });
        await ensureOk(res, "Could not change the rate.");
      }}
      onSaved={onChanged}
    />
  );
}

const STATE_LABEL: Record<PayRateHistoryEntry["state"], { label: string; tone: "ok" | "info" | "neutral" }> = {
  CURRENT: { label: "In force", tone: "ok" },
  FUTURE: { label: "Scheduled", tone: "info" },
  PAST: { label: "Past", tone: "neutral" },
  REMOVED: { label: "Removed", tone: "neutral" },
};

/** Rate history: every row, newest first; only a future row can be removed. */
export function PayHistorySection({ profile, caps, onChanged }: SectionProps) {
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  if (!profile.payRateHistory) return null;
  const entries = profile.payRateHistory.entries;

  async function remove(entry: PayRateHistoryEntry) {
    setBusyId(entry.id);
    setError(null);
    const forPerson = profile.id;
    try {
      const res = await fetch(`/api/admin/users/${forPerson}/pay?entryId=${encodeURIComponent(entry.id)}`, { method: "DELETE" });
      await ensureOk(res, "Could not remove the scheduled rate.");
      onChanged();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not remove the scheduled rate.");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <section aria-label="Rate history" className="flex flex-col gap-2 rounded-[10px] border border-[hsl(var(--e-border))] px-3 py-2.5">
      <h3 className="text-[0.65625rem] font-[600] uppercase tracking-[0.1em] text-[hsl(var(--e-gold-ink))]">Rate history</h3>
      {entries.length === 0 ? (
        <p className="text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">No rate saved yet.</p>
      ) : (
        <ul className="divide-y divide-[hsl(var(--e-border))] text-[0.8125rem]">
          {entries.map((entry) => (
            <li key={entry.id} className="flex flex-wrap items-center justify-between gap-2 py-1.5">
              <div className="min-w-0">
                <span className={`e-tnum font-[550] ${entry.state === "REMOVED" ? "line-through text-[hsl(var(--e-muted-foreground))]" : ""}`}>{formatRate(entry.hourlyRate)}</span>
                <span className="text-[hsl(var(--e-muted-foreground))]"> · from {formatRateDay(entry.effectiveFrom)}</span>
                <p className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
                  {entry.source === "BACKFILL" ? "Rate on file before history was kept" : `Saved ${formatDateTime(entry.createdAt)}${entry.createdByName ? ` by ${entry.createdByName}` : ""}`}
                  {entry.source === "BULK" ? " (bulk change)" : ""}
                </p>
              </div>
              <div className="flex items-center gap-1.5">
                <EPill tone={STATE_LABEL[entry.state].tone}>{STATE_LABEL[entry.state].label}</EPill>
                {entry.removable && caps.isAdmin ? (
                  <EButton size="sm" variant="ghost" disabled={busyId !== null} onClick={() => void remove(entry)} aria-label={`Remove the rate scheduled from ${formatRateDay(entry.effectiveFrom)}`}>
                    {busyId === entry.id ? "Removing…" : "Remove"}
                  </EButton>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}
      {error ? <p role="alert" className="text-[0.8125rem] text-[hsl(var(--e-danger))]">{error}</p> : null}
      <p className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
        Rates in force are kept as history. Rates per job type are set in{" "}
        <Link href="/v2/admin/settings?tab=rates" className="underline underline-offset-2">Settings → Rates</Link>.
      </p>
    </section>
  );
}
