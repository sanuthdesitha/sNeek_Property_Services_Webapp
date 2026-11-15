"use client";

/**
 * Step 1 of the social post generator (2026-11-17): pick photos. Candidates
 * come from the server without AI; every photo shows its score and the
 * reasons in words, and photos left out say why. Only properties with a
 * recorded marketing permission are ever offered.
 */
import * as React from "react";
import { ArrowDown, ArrowUp, X } from "lucide-react";
import { EButton, ECard } from "@/components/v2/ui/primitives";
import { E_CHIP_CLASS, E_CHIP_ON_CLASS } from "@/components/v2/ui/filter-chips";
import { EToneNotice, toneBandClass, tonePillClass, type ETone } from "@/components/v2/ui/tone-band";
import { NEVER_OFFERED_TEXT } from "@/lib/marketing/social/photo-fields";
import { SOCIAL_RATIOS, type SocialRatio } from "@/lib/marketing/social/networks";
import type { CandidateJob, CandidateList, CandidatePhoto } from "@/lib/marketing/social/view-types";
import { SOCIAL_API } from "./social-api";
import { cn } from "@/lib/utils";

export type CandidateFilters = { days: number; ratio: SocialRatio; includeBefore: boolean; hideUsed: boolean; listingFirst: boolean };

export type CandidateLoad = { state: "loading" } | { state: "failed"; message: string } | { state: "ready"; list: CandidateList; stale?: boolean };

export const MAX_CHOSEN = 6;

function photoTone(photo: CandidatePhoto): ETone | null {
  if (photo.state === "left_out") return "problem";
  if (photo.state === "needs_look") return "attention";
  return null;
}

function statePill(photo: CandidatePhoto): string {
  if (photo.state === "left_out") return "Left out";
  if (photo.state === "needs_look") return "Needs a look";
  if (photo.state === "checking") return "Still being checked";
  if (photo.state === "not_scored") return "Not scored yet";
  return photo.scoreWord;
}

export function previewSrc(photoId: string, ratio: SocialRatio) {
  return `${SOCIAL_API}/photos/${encodeURIComponent(photoId)}/preview?ratio=${encodeURIComponent(ratio)}`;
}

function PhotoTile({ photo, index, ratio, chosen, disabled, onToggle, onCheckBefore }: {
  photo: CandidatePhoto;
  index: number | null;
  ratio: SocialRatio;
  chosen: boolean;
  disabled: boolean;
  onToggle: () => void;
  onCheckBefore: () => void;
}) {
  const tone = photoTone(photo);
  const usable = photo.state === "usable" || photo.state === "not_scored";
  const reasons = photo.state === "left_out" ? [photo.leftOutReason ?? "Left out"] : photo.reasons.slice(0, 4);
  return (
    <li className={cn("min-w-0 overflow-hidden rounded-[var(--e-radius-lg)] border bg-[hsl(var(--e-surface))]", chosen ? "border-[hsl(var(--e-primary))] ring-2 ring-[hsl(var(--e-primary)/0.35)]" : "border-[hsl(var(--e-border))]")}>
      <div className="relative aspect-[4/5] bg-[hsl(var(--e-surface-sunken))]">
        {photo.state === "checking" ? (
          <div className="flex h-full items-center justify-center p-3 text-center text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">Still being checked</div>
        ) : photo.state === "left_out" && !photo.score ? (
          <div className="flex h-full items-center justify-center p-3 text-center text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">No preview</div>
        ) : (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={previewSrc(photo.photoId, ratio)} alt={`${photo.room} (cleaned preview)`} loading="lazy" className={cn("h-full w-full object-cover", photo.state === "left_out" && "opacity-60")} />
        )}
        {index !== null ? <span className="absolute left-2 top-2 flex h-7 w-7 items-center justify-center rounded-full bg-[hsl(var(--e-primary))] text-[0.8125rem] font-[650] text-[hsl(var(--e-primary-foreground))]">{index + 1}</span> : null}
        <span className="absolute right-2 top-2 rounded-full bg-[hsl(var(--e-surface)/0.92)] px-2 py-0.5 text-[0.8125rem] font-[650] e-tnum" aria-label={photo.score === null ? "Score not worked out" : `Score ${photo.score} of 100`}>{photo.score ?? "–"}</span>
      </div>
      <div className="space-y-1.5 p-2.5">
        <div className="flex items-start justify-between gap-2">
          <p className="min-w-0 text-[0.8125rem] font-[600] [overflow-wrap:anywhere]">{photo.room || "Photo"}</p>
          <span className={cn("shrink-0 text-[0.6875rem]", tone ? tonePillClass(tone) : "text-[hsl(var(--e-muted-foreground))]")}>{statePill(photo)}</span>
        </div>
        <details className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
          <summary className="cursor-pointer list-none [overflow-wrap:anywhere] sm:hidden">{reasons[0] ?? "No reasons recorded"} · reasons</summary>
          <ul className="space-y-0.5 max-sm:mt-1">
            {reasons.map((reason) => <li key={reason} className="[overflow-wrap:anywhere]">{reason}</li>)}
          </ul>
        </details>
        <ul className="hidden space-y-0.5 text-[0.75rem] text-[hsl(var(--e-muted-foreground))] sm:block">
          {reasons.map((reason) => <li key={reason} className="[overflow-wrap:anywhere]">{reason}</li>)}
        </ul>
        {usable ? (
          <EButton size="sm" variant={chosen ? "outline" : "primary"} className="w-full" disabled={disabled && !chosen} onClick={onToggle} aria-pressed={chosen}>
            {chosen ? "Remove from post" : "Use this photo"}
          </EButton>
        ) : null}
        {photo.state === "needs_look" ? (
          <EButton size="sm" variant="outline" className="w-full" disabled={disabled && !chosen} onClick={chosen ? onToggle : onCheckBefore} aria-pressed={chosen}>
            {chosen ? "Remove from post" : "I checked it, use it"}
          </EButton>
        ) : null}
      </div>
    </li>
  );
}

function JobCard({ job, selected, onSelect }: { job: CandidateJob; selected: boolean; onSelect: () => void }) {
  const tone: ETone | null = job.state === "usable" ? null : job.state === "left_out" ? "problem" : "attention";
  const permission = job.permission
    ? `Permission: ${job.permission.givenByName}, ${job.permission.method.toLowerCase().replace("_", " ")}. ${job.permission.allowSuburb ? "Suburb may be named." : "Suburb must not be named."}`
    : null;
  return (
    <li>
      <button type="button" onClick={onSelect} aria-pressed={selected} disabled={job.state !== "usable"} className={cn("w-full overflow-hidden rounded-[var(--e-radius-lg)] border text-left", selected ? "border-[hsl(var(--e-primary))]" : "border-[hsl(var(--e-border))]", job.state !== "usable" && "cursor-default")}>
        <div className={cn("flex items-start justify-between gap-2 px-3 py-2", tone ? toneBandClass(tone) : "")}>
          <span className="min-w-0">
            <span className="block text-[0.8125rem] font-[600] [overflow-wrap:anywhere]">{job.propertyName}</span>
            <span className="block text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">{job.jobNumber} · {job.finishedOn}{job.bedrooms ? ` · ${job.bedrooms} bed` : ""}</span>
          </span>
          <span className={cn("shrink-0 text-[0.6875rem]", tone ? tonePillClass(tone) : "text-[hsl(var(--e-muted-foreground))]")}>{job.state === "usable" ? (job.qaScore !== null ? `QA ${job.qaScore}%` : "QA passed") : job.state === "left_out" ? "Left out" : "Not usable"}</span>
        </div>
        <div className="space-y-0.5 px-3 pb-2 pt-1 text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
          {job.state === "usable" ? <p>{job.counts.usable} usable · {job.counts.listing} listing-angle{job.counts.before ? ` · ${job.counts.before} before` : ""}{job.counts.usedInPost ? ` · ${job.counts.usedInPost} used before` : ""}</p> : <p>{job.reason}</p>}
          {permission ? <p className="[overflow-wrap:anywhere]">{permission}</p> : null}
        </div>
      </button>
    </li>
  );
}

const PERIODS = [7, 14, 30, 60] as const;

export function GeneratorPhotos({
  load, filters, onFilters, chosen, onToggle, onMove, onCheckBefore, reviewed, onReviewed, onRetry, onScoreNow, scoring, frozen,
}: {
  load: CandidateLoad;
  filters: CandidateFilters;
  onFilters: (next: CandidateFilters) => void;
  chosen: CandidatePhoto[];
  onToggle: (photo: CandidatePhoto) => void;
  onMove: (photoId: string, direction: -1 | 1) => void;
  onCheckBefore: (photo: CandidatePhoto) => void;
  reviewed: boolean;
  onReviewed: (value: boolean) => void;
  onRetry: () => void;
  onScoreNow: () => void;
  scoring: boolean;
  frozen: boolean;
}) {
  const [jobId, setJobId] = React.useState<string | null>(null);
  const list = load.state === "ready" ? load.list : null;
  React.useEffect(() => {
    if (!list) return;
    if (!jobId || !list.jobs.some((job) => job.jobId === jobId && job.state === "usable")) setJobId(list.jobs.find((job) => job.state === "usable")?.jobId ?? null);
  }, [list, jobId]);
  const chosenIds = chosen.map((photo) => photo.photoId);
  const visibleJob = list?.jobs.find((job) => job.jobId === jobId) ?? null;
  const photos = (list?.photos ?? []).filter((photo) => photo.jobId === jobId);
  const ordered = filters.listingFirst ? [...photos].sort((a, b) => Number(b.fieldKind === "LISTING") - Number(a.fieldKind === "LISTING")) : photos;
  const mirrorWarning = chosen.find((photo) => /vanity|mirror/i.test(photo.room + photo.fieldLabel));
  const summary = list?.summary;
  const chip = (on: boolean) => cn(E_CHIP_CLASS, on && E_CHIP_ON_CLASS);

  return (
    <fieldset disabled={frozen} className="min-w-0 space-y-4">
      <legend className="sr-only">Pick photos</legend>
      <div role="group" aria-label="Filter candidate photos" className="flex flex-wrap gap-1.5">
        {PERIODS.map((days) => <button key={days} type="button" className={chip(filters.days === days)} aria-pressed={filters.days === days} onClick={() => onFilters({ ...filters, days })}>Last {days} days</button>)}
        <label className="inline-flex min-h-11 items-center gap-1.5 text-[0.8125rem]">
          <span>Fits</span>
          <select value={filters.ratio} onChange={(event) => onFilters({ ...filters, ratio: event.target.value as SocialRatio })} className="min-h-11 rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface))] px-2 max-sm:text-[1rem]">
            {SOCIAL_RATIOS.map((ratio) => <option key={ratio} value={ratio}>{ratio === "4:5" ? "Instagram 4:5" : ratio === "1:1" ? "Square 1:1" : "Landscape 1.91:1"}</option>)}
          </select>
        </label>
        <button type="button" className={chip(filters.listingFirst)} aria-pressed={filters.listingFirst} onClick={() => onFilters({ ...filters, listingFirst: !filters.listingFirst })}>Listing-angle photos first</button>
        <button type="button" className={chip(filters.includeBefore)} aria-pressed={filters.includeBefore} onClick={() => onFilters({ ...filters, includeBefore: !filters.includeBefore })}>Include before photos</button>
        <button type="button" className={chip(filters.hideUsed)} aria-pressed={filters.hideUsed} onClick={() => onFilters({ ...filters, hideUsed: !filters.hideUsed })}>Hide used photos</button>
      </div>
      <p className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">Only properties with marketing permission · always on</p>

      <dl aria-label="Candidates" className="grid grid-cols-2 gap-2 sm:grid-cols-5">
        {[
          { label: "Jobs finished", value: summary?.jobsCompleted, note: list ? `${list.from} to ${list.to}` : "" },
          { label: "QA passed, no open case", value: summary?.qaPassedClean, note: summary ? `${summary.qaNotReviewed} not reviewed yet · ${summary.qaFailed} failed · ${summary.openCase} open case` : "" },
          { label: "At properties with permission", value: summary?.atPermission, note: summary ? `${summary.noPermission} have no permission recorded` : "" },
          { label: "Photos scored", value: summary?.photosScored, note: summary ? `${summary.stillChecking} still being checked` : "" },
          { label: "Usable now", value: summary?.usable, note: summary ? `${summary.leftOut} left out, reasons shown` : "" },
        ].map((tile) => (
          <div key={tile.label} className="min-w-0 rounded-[var(--e-radius-lg)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface))] p-3 max-sm:last:col-span-2">
            <dd className="font-serif text-[1.5rem] leading-none e-tnum">{typeof tile.value === "number" ? tile.value : "–"}</dd>
            <dt className="mt-1 text-[0.75rem] font-[550]">{tile.label}</dt>
            {tile.note ? <p className="mt-0.5 text-[0.6875rem] text-[hsl(var(--e-muted-foreground))]">{tile.note}</p> : null}
          </div>
        ))}
      </dl>

      {load.state === "loading" ? <p role="status" className="text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">Loading candidate photos…</p> : null}
      {load.state === "failed" ? (
        <EToneNotice tone="problem" role="alert" title="Candidate photos could not be loaded.">
          <p>{load.message}</p>
          <EButton size="sm" variant="outline" className="mt-2" onClick={onRetry}>Try again</EButton>
        </EToneNotice>
      ) : null}
      {load.state === "ready" && load.stale ? <EToneNotice tone="attention" role="status">Showing the last list; the newest read failed.</EToneNotice> : null}
      {list && summary && summary.usable === 0 ? (
        <EToneNotice tone="info" title={`No usable photos in the last ${filters.days} days.`}>
          <p>{summary.noPermission} jobs need permission and {summary.qaNotReviewed} need QA. <a className="underline" href="/v2/admin/marketing/social-accounts#permissions">Open the permission register</a>.</p>
          {summary.stillChecking ? <EButton size="sm" variant="outline" className="mt-2" onClick={onScoreNow} disabled={scoring}>{scoring ? "Scoring…" : `Score the ${summary.stillChecking} waiting now`}</EButton> : null}
        </EToneNotice>
      ) : null}

      {list && summary && summary.usable > 0 ? (
        <div className="grid min-w-0 grid-cols-1 gap-4 lg:grid-cols-[minmax(0,15rem)_minmax(0,1fr)_minmax(0,16rem)]">
          <section aria-labelledby="social-jobs-heading" className="min-w-0 space-y-2">
            <h3 id="social-jobs-heading" className="text-[0.8125rem] font-[600]">Jobs with usable photos ({list.jobs.filter((job) => job.state === "usable").length})</h3>
            <label className="block sm:hidden">
              <span className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">Job</span>
              <select value={jobId ?? ""} onChange={(event) => setJobId(event.target.value)} className="mt-1 min-h-11 w-full rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface))] px-2 text-[1rem]">
                {list.jobs.filter((job) => job.state === "usable").map((job) => <option key={job.jobId} value={job.jobId}>{job.propertyName} · {job.jobNumber}{job.qaScore !== null ? ` · QA ${job.qaScore}%` : ""}</option>)}
              </select>
            </label>
            <ul className="space-y-2 max-sm:hidden">
              {list.jobs.map((job) => <JobCard key={job.jobId} job={job} selected={job.jobId === jobId} onSelect={() => setJobId(job.jobId)} />)}
            </ul>
            <p className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))] max-sm:hidden">{summary.noPermission} jobs at properties with no permission are not listed. <a className="underline" href="/v2/admin/marketing/social-accounts#permissions">Ask those clients</a> opens the permission register.</p>
          </section>

          <section aria-labelledby="social-photos-heading" className="min-w-0 space-y-2">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h3 id="social-photos-heading" className="text-[0.8125rem] font-[600]">{visibleJob ? `${visibleJob.propertyName} · ${visibleJob.jobNumber} · ${visibleJob.counts.usable} usable, ${visibleJob.counts.leftOut} left out` : "Photos"}</h3>
              <span className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">Sort: score ↓</span>
            </div>
            <ul className="grid grid-cols-2 gap-2 xl:grid-cols-3">
              {ordered.map((photo) => (
                <PhotoTile
                  key={photo.photoId}
                  photo={photo}
                  ratio={filters.ratio}
                  index={chosenIds.includes(photo.photoId) ? chosenIds.indexOf(photo.photoId) : null}
                  chosen={chosenIds.includes(photo.photoId)}
                  disabled={chosen.length >= MAX_CHOSEN}
                  onToggle={() => onToggle(photo)}
                  onCheckBefore={() => onCheckBefore(photo)}
                />
              ))}
            </ul>
            <p className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">{NEVER_OFFERED_TEXT} Photos still being checked appear when the check finishes; a failed check says &quot;Could not be scored&quot;, never a low score.</p>
          </section>

          <ChosenPanel chosen={chosen} onToggle={onToggle} onMove={onMove} reviewed={reviewed} onReviewed={onReviewed} mirrorWarning={mirrorWarning ?? null} />
        </div>
      ) : null}
    </fieldset>
  );
}

function ChosenPanel({ chosen, onToggle, onMove, reviewed, onReviewed, mirrorWarning }: {
  chosen: CandidatePhoto[];
  onToggle: (photo: CandidatePhoto) => void;
  onMove: (photoId: string, direction: -1 | 1) => void;
  reviewed: boolean;
  onReviewed: (value: boolean) => void;
  mirrorWarning: CandidatePhoto | null;
}) {
  return (
    <aside aria-labelledby="social-chosen-heading" className="min-w-0 space-y-3">
      <ECard className="space-y-2 p-3">
        <h3 id="social-chosen-heading" className="text-[0.8125rem] font-[600]">Chosen for this post ({chosen.length} of {MAX_CHOSEN})</h3>
        {chosen.length === 0 ? <p className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">Nothing chosen yet.</p> : null}
        <ol className="space-y-1.5">
          {chosen.map((photo, index) => (
            <li key={photo.photoId} className="flex items-center gap-2 text-[0.8125rem]">
              <span className="w-5 shrink-0 text-center font-[650] e-tnum">{index + 1}</span>
              <span className="min-w-0 flex-1">
                <span className="block truncate font-[550]">{photo.room}</span>
                <span className="block truncate text-[0.6875rem] text-[hsl(var(--e-muted-foreground))]">{photo.propertyName}</span>
              </span>
              <EButton size="icon" variant="ghost" aria-label={`Move ${photo.room} up`} disabled={index === 0} onClick={() => onMove(photo.photoId, -1)}><ArrowUp className="h-3.5 w-3.5" aria-hidden /></EButton>
              <EButton size="icon" variant="ghost" aria-label={`Move ${photo.room} down`} disabled={index === chosen.length - 1} onClick={() => onMove(photo.photoId, 1)}><ArrowDown className="h-3.5 w-3.5" aria-hidden /></EButton>
              <EButton size="icon" variant="ghost" aria-label={`Remove ${photo.room}`} onClick={() => onToggle(photo)}><X className="h-3.5 w-3.5" aria-hidden /></EButton>
            </li>
          ))}
        </ol>
      </ECard>
      <EToneNotice tone="attention" title="Before you go on">
        {mirrorWarning ? <p className="mb-2">The {mirrorWarning.room.toLowerCase()} photo may show a mirror. Look for reflections of people or screens.</p> : null}
        <p className="mb-2">sNeek cannot detect faces, belongings, mail or screens. Look at every photo yourself.</p>
        <label className="flex min-h-11 items-start gap-2 text-[0.8125rem] text-[hsl(var(--e-foreground))]">
          <input type="checkbox" className="mt-1 h-4 w-4" checked={reviewed} onChange={(event) => onReviewed(event.target.checked)} />
          <span>I looked at every photo: no faces, guest belongings, mail, screens, plates or street numbers.</span>
        </label>
      </EToneNotice>
      <p className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">Mixing properties is allowed; each photo keeps its own permission. Changing the draft&apos;s photos keeps captions you edited.</p>
    </aside>
  );
}
