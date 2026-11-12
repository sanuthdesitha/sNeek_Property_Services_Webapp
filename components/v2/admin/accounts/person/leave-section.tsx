"use client";

/**
 * Leave and days off for one person (Wave E, 2026-11).
 *  List   → profile.leave (recent and upcoming)
 *  Add    → POST   /api/admin/users/[id]/leave { startDate, endDate, kind, note }
 *  Remove → DELETE /api/admin/users/[id]/leave?leaveId=…  (records not yet ended)
 * ADMIN, and OPS_MANAGER with the accounts pack at manage (as office notes).
 * The Calendar's unavailability lane, cleaner suggestions and assignment checks
 * treat these days as unavailable. Dates are calendar dates.
 */
import { useEffect, useState } from "react";
import { EButton } from "@/components/v2/ui/primitives";
import { EPill } from "@/components/v2/ui/pill";
import { EField, EInput, ESelect } from "@/components/v2/admin/estate-kit";
import type { PersonCapabilities, PersonProfile } from "@/lib/accounts/person-types";
import { LEAVE_KINDS, LEAVE_KIND_LABEL, type LeaveKind } from "@/lib/accounts/leave-rules";
import { sydneyTodayKey } from "@/lib/time/sydney-range";
import { ensureOk } from "./editable-section";

type SectionProps = { profile: PersonProfile; caps: PersonCapabilities; onChanged: () => void };
type LeaveDraft = { startDate: string; endDate: string; kind: LeaveKind; note: string };

function emptyDraft(): LeaveDraft {
  const today = sydneyTodayKey();
  return { startDate: today, endDate: today, kind: "LEAVE", note: "" };
}

export function LeaveSection({ profile, caps, onChanged }: SectionProps) {
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState<LeaveDraft>(emptyDraft);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setAdding(false);
    setDraft(emptyDraft());
    setBusy(null);
    setError(null);
  }, [profile.id]);

  if (!profile.leave) return null;
  const canEdit = Boolean(caps.canManageLeave);
  const today = sydneyTodayKey();

  async function save() {
    setBusy("save");
    setError(null);
    try {
      const res = await fetch(`/api/admin/users/${profile.id}/leave`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ startDate: draft.startDate, endDate: draft.endDate, kind: draft.kind, ...(draft.note.trim() ? { note: draft.note.trim() } : {}) }),
      });
      await ensureOk(res, "Could not record the leave.");
      setAdding(false);
      setDraft(emptyDraft());
      onChanged();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not record the leave. Your entry is still here.");
    } finally {
      setBusy(null);
    }
  }

  async function remove(id: string) {
    setBusy(id);
    setError(null);
    try {
      const res = await fetch(`/api/admin/users/${profile.id}/leave?leaveId=${encodeURIComponent(id)}`, { method: "DELETE" });
      await ensureOk(res, "Could not remove the leave.");
      onChanged();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not remove the leave.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <section aria-label="Leave and days off" className="flex flex-col gap-2 rounded-[10px] border border-[hsl(var(--e-border))] px-3 py-2.5">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-[0.65625rem] font-[600] uppercase tracking-[0.1em] text-[hsl(var(--e-gold-ink))]">Leave and days off{adding ? ", adding" : ""}</h3>
        {canEdit && !adding ? <EButton size="sm" variant="ghost" onClick={() => setAdding(true)}>Add</EButton> : null}
      </div>
      {profile.leave.length === 0 ? (
        <p className="text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">No leave recorded.</p>
      ) : (
        <ul className="divide-y divide-[hsl(var(--e-border))] text-[0.8125rem]">
          {profile.leave.map((entry) => (
            <li key={entry.id} className="flex flex-wrap items-center justify-between gap-2 py-1.5">
              <div className="min-w-0">
                <span className="font-[550]">{entry.reason}</span>
                {entry.note ? <p className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))] [overflow-wrap:anywhere]">{entry.note}</p> : null}
              </div>
              <div className="flex items-center gap-1.5">
                {entry.endDate < today ? <EPill tone="neutral">Ended</EPill> : entry.startDate <= today ? <EPill tone="warn">Now</EPill> : <EPill tone="info">Upcoming</EPill>}
                {canEdit && entry.removable ? (
                  <EButton size="sm" variant="ghost" disabled={busy !== null} onClick={() => void remove(entry.id)} aria-label={`Remove ${entry.reason}`}>
                    {busy === entry.id ? "Removing…" : "Remove"}
                  </EButton>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}
      {adding ? (
        <fieldset disabled={busy !== null} className="grid gap-2.5 sm:grid-cols-2">
          <EField label="Kind">
            <ESelect value={draft.kind} onChange={(e) => setDraft({ ...draft, kind: e.target.value as LeaveKind })}>
              {LEAVE_KINDS.map((kind) => <option key={kind} value={kind}>{LEAVE_KIND_LABEL[kind]}</option>)}
            </ESelect>
          </EField>
          <EField label="Note (optional)">
            <EInput value={draft.note} maxLength={500} onChange={(e) => setDraft({ ...draft, note: e.target.value })} />
          </EField>
          <EField label="First day">
            <EInput type="date" value={draft.startDate} onChange={(e) => setDraft({ ...draft, startDate: e.target.value, endDate: draft.endDate < e.target.value ? e.target.value : draft.endDate })} />
          </EField>
          <EField label="Last day">
            <EInput type="date" min={draft.startDate} value={draft.endDate} onChange={(e) => setDraft({ ...draft, endDate: e.target.value })} />
          </EField>
          <div className="flex justify-end gap-1.5 sm:col-span-2">
            <EButton size="sm" variant="ghost" onClick={() => { setAdding(false); setError(null); }}>Cancel</EButton>
            <EButton size="sm" variant="primary" onClick={() => void save()}>{busy === "save" ? "Saving…" : "Save"}</EButton>
          </div>
        </fieldset>
      ) : null}
      {error ? <p role="alert" className="text-[0.8125rem] text-[hsl(var(--e-danger))]">{error}</p> : null}
      <p className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">The calendar, cleaner suggestions and assignments treat these days as unavailable.</p>
    </section>
  );
}
