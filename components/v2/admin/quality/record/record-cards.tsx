"use client";

/**
 * The smaller cards of the inspection record (board "QualityInspection"):
 * accountability score, who fixes it, inspector sign-off, damage, for the
 * next clean, and the cleaner's submission evidence with the photo checks.
 * Read-only. Times are formatted in the organisation's time zone.
 */
import * as React from "react";
import Link from "next/link";
import { formatInTimeZone } from "date-fns-tz";
import { Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { EPill } from "@/components/v2/ui/pill";
import { EToneCard } from "@/components/v2/ui/tone-band";
import { PhotoIntegrityFlags } from "@/components/v2/qa/photo-integrity-flags";
import type { InspectionRecord } from "@/lib/quality/inspection-record-types";
import { formatAud } from "@/lib/quality/issue-presentation";
import type { EvidenceUrls } from "../issues/issue-evidence";
import { RecordThumb } from "./record-thumb";

const CARD = "rounded-[var(--e-radius-lg)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface))]";
const MUTED = "text-[hsl(var(--e-muted-foreground))]";

export function moment(value: string | null, timeZone: string, pattern = "EEE d MMM HH:mm"): string | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : formatInTimeZone(date, timeZone, pattern);
}

function CardTitle({ id, children, aside }: { id: string; children: React.ReactNode; aside?: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-2">
      <h2 id={id} className="text-[0.9375rem] font-[650]">
        {children}
      </h2>
      {aside}
    </div>
  );
}

export function ScoreCard({ record }: { record: InspectionRecord }) {
  const score = record.score;
  return (
    <section aria-labelledby="record-score-title" className={cn(CARD, "space-y-2 p-4")}>
      <CardTitle id="record-score-title" aside={score?.ratingLabel ? <EPill tone={score.ratingTone}>{score.ratingLabel}</EPill> : null}>
        Accountability score
      </CardTitle>
      {score ? (
        <>
          <p className="flex flex-wrap items-baseline gap-2">
            <span className="e-serif text-[2.5rem] leading-none e-tnum">{Math.round(score.score)}</span>
            <span className={cn("text-[0.875rem]", MUTED)}>of 100 · QA score for this clean</span>
          </p>
          <p className="text-[0.8125rem] text-[hsl(var(--e-text-secondary))]">
            {score.lines.map((line) => `${line.label} ×${line.count}`).join(" · ")}
          </p>
          {score.rawScore !== null ? (
            <p className={cn("text-[0.8125rem]", MUTED)}>
              Graded {Math.round(score.rawScore)}; adjusted since{score.adjustmentReason ? `: ${score.adjustmentReason}` : "."}
            </p>
          ) : null}
          {score.managementReview ? <p className="text-[0.8125rem]">A critical finding sends this clean to management review.</p> : null}
          <p className="text-[0.8125rem] font-[600]">Deductions are proposals; the office decides.</p>
        </>
      ) : (
        <p className={cn("text-[0.875rem]", MUTED)}>No QA score is linked to this inspection.</p>
      )}
    </section>
  );
}

export function WhoFixesCard({ record }: { record: InspectionRecord }) {
  const who = record.whoFixes;
  return (
    <section id="record-fix" aria-labelledby="record-fix-title" className={cn(CARD, "space-y-2.5 p-4")}>
      <CardTitle id="record-fix-title" aside={who.status ? <EPill tone={who.status.tone}>{who.status.label}</EPill> : null}>
        Who fixes it
      </CardTitle>
      {who.events.length ? (
        <ol className="space-y-2 text-[0.8125rem]">
          {who.events.map((event, index) => (
            <li key={`${event.at ?? "untimed"}-${index}`} className="grid grid-cols-[6.5rem_minmax(0,1fr)] gap-2">
              <span className={cn("e-tnum", MUTED)}>{moment(event.at, record.timeZone, "EEE HH:mm") ?? "Time not recorded"}</span>
              <span className="[overflow-wrap:anywhere]">{event.text}</span>
            </li>
          ))}
        </ol>
      ) : null}
      {who.note ? <p className={cn("text-[0.75rem]", MUTED)}>{who.note}</p> : null}
    </section>
  );
}

export function SignOffCard({ record, urls }: { record: InspectionRecord; urls: EvidenceUrls }) {
  const signOff = record.signOff;
  const signedAt = moment(signOff?.signedAt ?? null, record.timeZone);
  const signatureUrl = signOff?.signatureKey ? urls[signOff.signatureKey] : null;
  return (
    <section id="record-signoff" aria-labelledby="record-signoff-title" className={cn(CARD, "space-y-2.5 p-4")}>
      <CardTitle id="record-signoff-title">Inspector sign-off</CardTitle>
      {signOff ? (
        <>
          <p className="flex items-start gap-2 text-[0.8125rem]">
            <span
              aria-hidden
              className={cn(
                "mt-0.5 inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-[4px] border",
                signOff.attested ? "border-[hsl(var(--e-primary))] bg-[hsl(var(--e-primary))] text-[hsl(var(--e-primary-foreground))]" : "border-[hsl(var(--e-border-strong))]",
              )}
            >
              {signOff.attested ? <Check className="h-3 w-3" /> : null}
            </span>
            <span>
              <span className="sr-only">{signOff.attested ? "Ticked: " : "Not ticked: "}</span>I attest that this QA inspection is accurate and complete, and was carried out by me
              {signOff.signedByName ? ` (${signOff.signedByName})` : ""}.
            </span>
          </p>
          <div className="flex min-h-16 items-center rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] px-4 py-2">
            {signatureUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={signatureUrl} alt={`Signature of ${signOff.signedByName ?? "the inspector"}`} className="max-h-14 max-w-full rounded-[4px] bg-white object-contain p-1" />
            ) : (
              <span className="e-serif text-[1.5rem] italic">{signOff.signedByName ?? "Name not recorded"}</span>
            )}
          </div>
          <p className={cn("text-[0.75rem]", MUTED)}>
            {signedAt ? `Signed ${signedAt}.` : "Signing time not recorded."} The signature is on the inspection report.
          </p>
        </>
      ) : (
        <p className={cn("text-[0.875rem]", MUTED)}>No sign-off was recorded with this inspection.</p>
      )}
    </section>
  );
}

export function DamageCard({ record, urls }: { record: InspectionRecord; urls: EvidenceUrls }) {
  if (record.damage.length === 0) {
    return (
      <section aria-labelledby="record-damage-title" className={cn(CARD, "space-y-1 p-4")}>
        <CardTitle id="record-damage-title">Damage</CardTitle>
        <p className={cn("text-[0.875rem]", MUTED)}>No damage recorded.</p>
      </section>
    );
  }
  return (
    <EToneCard
      tone="attention"
      aria-labelledby="record-damage-title"
      header={
        <>
          <h2 id="record-damage-title" className="text-[0.9375rem] font-[650]">
            Damage · {record.damage.length} {record.damage.length === 1 ? "entry" : "entries"}
          </h2>
          <p className="text-[0.8125rem] opacity-80">Recorded by the inspector, not the cleaner&apos;s fault until decided</p>
        </>
      }
      pill="Recorded"
    >
      <ul className="space-y-3">
        {record.damage.map((entry) => (
          <li key={entry.id} className="flex gap-3 text-[0.8125rem]">
            {entry.photoKeys[0] ? <RecordThumb url={urls[entry.photoKeys[0]]} label={entry.area || undefined} alt={`Damage photo${entry.area ? `, ${entry.area}` : ""}`} /> : null}
            <div className="min-w-0 space-y-0.5">
              <p className="[overflow-wrap:anywhere]">{entry.description || "No description recorded."}</p>
              <p className={MUTED}>
                {[entry.area, entry.severity ? `${entry.severity.charAt(0)}${entry.severity.slice(1).toLowerCase()} severity` : null, entry.estimatedCost !== null ? `about ${formatAud(entry.estimatedCost)}` : null]
                  .filter(Boolean)
                  .join(" · ")}
              </p>
            </div>
          </li>
        ))}
      </ul>
    </EToneCard>
  );
}

export function NextCleanCard({ record }: { record: InspectionRecord }) {
  return (
    <section aria-labelledby="record-next-title" className={cn(CARD, "overflow-hidden")}>
      <div className="border-b border-[hsl(var(--e-border))] px-4 py-3">
        <h2 id="record-next-title" className="text-[0.9375rem] font-[650]">
          For the next clean
        </h2>
        <p className={cn("text-[0.8125rem]", MUTED)}>Requests the inspector left for the next clean at {record.propertyName}</p>
      </div>
      <div className="space-y-2 px-4 py-3 text-[0.8125rem]">
        {record.nextClean.length ? (
          record.nextClean.map((request) => (
            <p key={request.id} className="[overflow-wrap:anywhere]">
              <span className="font-[600]">{request.kind === "DEEP_CLEAN_AREA" ? "Deep clean area" : "Special request"}</span>
              {request.area ? ` · ${request.area}: ` : " · "}
              {request.note}
            </p>
          ))
        ) : (
          <p className={MUTED}>No requests for the next clean.</p>
        )}
      </div>
    </section>
  );
}

export function EvidenceCard({ record, urls }: { record: InspectionRecord; urls: EvidenceUrls }) {
  const evidence = record.evidence;
  const more = evidence ? evidence.photoCount - evidence.photos.length : 0;
  return (
    <section id="record-evidence" aria-labelledby="record-evidence-title" className={cn(CARD, "space-y-3 p-4")}>
      <CardTitle
        id="record-evidence-title"
        aside={
          evidence ? (
            <p className={cn("text-right text-[0.75rem]", MUTED)}>
              {[evidence.submittedByName, `${evidence.photoCount} ${evidence.photoCount === 1 ? "photo" : "photos"}`, moment(evidence.submittedAt, record.timeZone, "'submitted' HH:mm")]
                .filter(Boolean)
                .join(" · ")}
            </p>
          ) : null
        }
      >
        Cleaner submission evidence
      </CardTitle>
      {evidence ? (
        <div className="flex flex-wrap gap-2">
          {evidence.photos.map((photo) => (
            <RecordThumb key={photo.id} url={urls[photo.key]} label={photo.label} alt={`Cleaner photo: ${photo.label}`} />
          ))}
          {more > 0 ? (
            <Link
              href={`/v2/admin/jobs/${record.jobId}`}
              className="flex h-[4.5rem] w-[5.5rem] items-center justify-center rounded-[var(--e-radius)] border border-dashed border-[hsl(var(--e-border-strong))] text-[0.8125rem] text-[hsl(var(--e-text-secondary))] underline-offset-2 hover:underline"
            >
              +{more} more
            </Link>
          ) : null}
          {evidence.photoCount === 0 ? <p className={cn("text-[0.875rem]", MUTED)}>The cleaner&apos;s form has no photos.</p> : null}
        </div>
      ) : (
        <p className={cn("text-[0.875rem]", MUTED)}>No cleaner form has been submitted for this job.</p>
      )}
      <PhotoIntegrityFlags key={record.jobId} jobId={record.jobId} />
    </section>
  );
}
