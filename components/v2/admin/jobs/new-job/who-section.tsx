"use client";

/**
 * Section 4 / phone step "Who": ranked cleaners for the chosen slot with the
 * existing ranker's reasons (leave, clash, roster, cleans here, distance, QA).
 * Blocked people stay listed with the reason. The preferred cleaner's
 * automatic offer on create is said out loud; "Leave unassigned and skip the
 * preferred cleaner" turns it off for this job. Nothing is offered until
 * Create.
 */
import { tourTarget } from "@/lib/tutorials/targets";
import { cn } from "@/lib/utils";
import { EButton } from "@/components/v2/ui/primitives";
import { EToneNotice } from "@/components/v2/ui/tone-band";
import { dayLabel, type CleanerChoice, type NewJobDraft } from "@/lib/jobs/new-job/draft";
import type { CleanerSuggestion } from "@/lib/jobs/cleaner-suggestions";
import type { NewJobDayCheck, NewJobPropertyFacts } from "@/lib/jobs/new-job/types";
import type { ReadState } from "./use-new-job-data";
import { Faint, NewMark } from "./new-job-ui";

export type WhoSectionProps = {
  draft: NewJobDraft;
  facts: ReadState<NewJobPropertyFacts>;
  day: ReadState<NewJobDayCheck>;
  update: (patch: Partial<NewJobDraft>) => void;
  allowSecond: boolean;
  setAllowSecond: (value: boolean) => void;
  compact?: boolean;
};

function initials(name: string): string {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase() ?? "").join("") || "?";
}

export function preferredNotice(facts: NewJobPropertyFacts | null, choice: CleanerChoice): string {
  const preferred = facts?.preferredCleaner ?? null;
  if (!facts) return "Choose a property to see who it prefers.";
  if (!preferred) return "This property has no preferred cleaner, so nobody is offered the job unless you choose someone.";
  if (!preferred.active) return `${preferred.name} is the property's preferred cleaner but is not an active cleaner, so nobody is offered the job automatically.`;
  if (choice.kind === "unassigned") return `${preferred.name} is the property's preferred cleaner. You chose to leave this job unassigned, so nobody is offered it.`;
  if (choice.kind === "chosen") return `${preferred.name} is the property's preferred cleaner. As today, the job is offered to them on create and then replaced by the cleaner you chose.`;
  return `${preferred.name} is the property's preferred cleaner and is offered the job automatically when it is created. Choosing someone below replaces them.`;
}

function blockerLabel(suggestion: CleanerSuggestion, compact: boolean): string {
  if (suggestion.blocker?.kind === "leave") return compact ? "Away" : "Not available";
  if (suggestion.blocker?.kind === "clash") return "Clash";
  return "Not available";
}

function windowText(draft: NewJobDraft): string {
  const start = draft.startTime || "start not set";
  const hours = Number(draft.estimatedHours) > 0 ? Number(draft.estimatedHours) : null;
  if (!draft.startTime || hours === null) return draft.dueTime ? `${start}–${draft.dueTime}` : start;
  const [h, m] = draft.startTime.split(":").map(Number);
  const end = h * 60 + m + Math.round(hours * 60);
  const endText = `${String(Math.floor(end / 60) % 24).padStart(2, "0")}:${String(end % 60).padStart(2, "0")}`;
  return `${start}–${endText}`;
}

export function whoAside(draft: NewJobDraft): string {
  if (!draft.dayKey) return "Choose a date to rank cleaners · nothing is offered until Create";
  return `Suggestions for ${dayLabel(draft.dayKey)} ${windowText(draft)} · nothing is offered until Create`;
}

export function WhoSection({ draft, facts, day, update, allowSecond, setAllowSecond, compact = false }: WhoSectionProps) {
  const preferredId = facts.data?.preferredCleaner?.active ? facts.data.preferredCleaner.id : null;
  const choice = draft.cleaner;
  const suggestions = day.data?.suggestions.kind === "ok" ? day.data.suggestions.items : [];
  const chosenIds = choice.kind === "chosen" ? choice.ids : [];

  function choose(suggestion: CleanerSuggestion) {
    if (choice.kind === "chosen" && allowSecond) {
      if (choice.ids.includes(suggestion.cleanerId)) return;
      update({ cleaner: { kind: "chosen", ids: [...choice.ids, suggestion.cleanerId], names: [...choice.names, suggestion.name] } });
      return;
    }
    if (suggestion.cleanerId === preferredId && !allowSecond) {
      update({ cleaner: { kind: "preferred" } });
      return;
    }
    update({ cleaner: { kind: "chosen", ids: [suggestion.cleanerId], names: [suggestion.name] } });
  }

  function remove(cleanerId: string) {
    if (choice.kind !== "chosen") return;
    const index = choice.ids.indexOf(cleanerId);
    const ids = choice.ids.filter((id) => id !== cleanerId);
    const names = choice.names.filter((_, i) => i !== index);
    update({ cleaner: ids.length ? { kind: "chosen", ids, names } : { kind: "preferred" } });
  }

  const ordered = [...suggestions].sort((a, b) => (a.cleanerId === preferredId ? -1 : b.cleanerId === preferredId ? 1 : 0));

  return (
    <div {...tourTarget("admin.jobs.create.cleaner")} className="space-y-3">
      <EToneNotice tone="info" className="p-3">
        <span aria-hidden className="mr-1 font-[600]">i</span>
        {preferredNotice(facts.data, choice)}
      </EToneNotice>
      {!draft.propertyId || (draft.mode === "one" && !draft.dayKey) ? (
        <Faint>Choose a property and a date to rank cleaners for that slot.</Faint>
      ) : draft.mode !== "one" ? (
        <Faint>Suggestions rank one slot; for several dates or a repeating rule they are ranked for the first date only.</Faint>
      ) : null}
      {day.status === "loading" && !day.data ? <Faint>Ranking cleaners…</Faint> : null}
      {day.status === "error" && !day.data ? (
        <p role="alert" className="text-[0.8125rem] text-[hsl(var(--e-danger))]">Suggestions could not be loaded: {day.error} <button type="button" className="underline" onClick={day.reload}>Try again</button></p>
      ) : null}
      {day.data && suggestions.length === 0 && day.data.suggestions.kind === "ok" ? <Faint>No active cleaners to suggest.</Faint> : null}
      {ordered.length > 0 ? (
        <ul className={cn("overflow-hidden rounded-[var(--e-radius)] border border-[hsl(var(--e-border))]", day.stale && "opacity-70")} aria-label="Suggested cleaners" aria-busy={day.status === "loading" || undefined}>
          {ordered.map((suggestion) => {
            const isPreferred = suggestion.cleanerId === preferredId;
            const chosen = chosenIds.includes(suggestion.cleanerId);
            const offeredOnCreate = isPreferred && choice.kind === "preferred";
            const reasons = suggestion.blocker ? [suggestion.blocker.reason] : suggestion.reasons;
            return (
              <li key={suggestion.cleanerId} className={cn("flex items-center gap-3 border-t border-[hsl(var(--e-border))] px-3 py-2.5 first:border-t-0", suggestion.blocker && "opacity-80")}>
                <span aria-hidden className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[hsl(var(--e-muted))] text-[0.6875rem] font-[600] text-[hsl(var(--e-text-secondary))]">{initials(suggestion.name)}</span>
                <div className="min-w-0 flex-1">
                  <p className="text-[0.875rem] font-[600] text-[hsl(var(--e-foreground))]">
                    {suggestion.name}
                    {isPreferred && !compact ? <span className="ml-1.5 rounded-full bg-[hsl(var(--e-gold-soft))] px-1.5 py-0.5 text-[0.6875rem] font-[550] text-[hsl(var(--e-gold-ink))]">preferred</span> : null}
                  </p>
                  <p className="break-words text-[0.75rem] text-[hsl(var(--e-text-secondary))]">{reasons.join(" · ") || "No history here yet"}</p>
                </div>
                <div className="shrink-0">
                  {suggestion.blocker ? (
                    <span className="rounded-full border border-[hsl(var(--e-band-problem-line))] bg-[hsl(var(--e-band-problem-bg))] px-2 py-0.5 text-[0.6875rem] font-[550] text-[hsl(var(--e-band-problem-fg))]">{blockerLabel(suggestion, compact)}</span>
                  ) : offeredOnCreate ? (
                    <span className="rounded-full border border-[hsl(var(--e-band-good-line))] bg-[hsl(var(--e-band-good-bg))] px-2 py-0.5 text-[0.6875rem] font-[550] text-[hsl(var(--e-band-good-fg))]">{compact ? "Preferred" : "Offered on create"}</span>
                  ) : chosen ? (
                    <EButton type="button" size="sm" variant="outline" onClick={() => remove(suggestion.cleanerId)} aria-label={`Remove ${suggestion.name}`}>Chosen · Remove</EButton>
                  ) : choice.kind === "unassigned" ? null : (
                    <EButton type="button" size="sm" variant="outline" onClick={() => choose(suggestion)} aria-label={`Choose ${suggestion.name}`}>Choose</EButton>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      ) : null}
      <div className="flex flex-wrap gap-x-5 gap-y-1">
        {!compact ? (
          <label className="flex min-h-[44px] items-center gap-2 text-[0.8125rem]">
            <input type="checkbox" checked={allowSecond} disabled={choice.kind === "unassigned"} onChange={(event) => setAllowSecond(event.target.checked)} />
            Add a second cleaner
          </label>
        ) : null}
        <label className="flex min-h-[44px] items-center gap-2 text-[0.8125rem]">
          <input
            type="checkbox"
            checked={choice.kind === "unassigned"}
            onChange={(event) => update({ cleaner: event.target.checked ? { kind: "unassigned" } : { kind: "preferred" } })}
          />
          {compact ? "Leave unassigned, skip preferred" : "Leave unassigned and skip the preferred cleaner"} <NewMark />
        </label>
      </div>
    </div>
  );
}
