"use client";

/**
 * Section 2 / phone step "Job": the job type, then everything the property
 * fills in, each marked "from property" or "changed". Prices and rates are
 * the property's own, read by the same rules as invoicing and assignment;
 * a missing one says "not set", never $0.
 */
import { tourTarget } from "@/lib/tutorials/targets";
import Link from "next/link";
import { EInput } from "@/components/v2/admin/estate-kit";
import { EButton } from "@/components/v2/ui/primitives";
import { ESelect } from "@/components/v2/admin/estate-kit";
import {
  FEATURED_JOB_TYPES,
  NEW_JOB_TYPES,
  formatMoney,
  jobTypeLabel,
  type NewJobDraft,
  type NewJobType,
} from "@/lib/jobs/new-job/draft";
import type { NewJobDay, NewJobPropertyFacts } from "@/lib/jobs/new-job/types";
import type { ReadState } from "./use-new-job-data";
import { ChoiceChip, FactRow, Faint, SourceMark } from "./new-job-ui";

export type WhatSectionProps = {
  draft: NewJobDraft;
  facts: ReadState<NewJobPropertyFacts>;
  firstDay: NewJobDay | null;
  update: (patch: Partial<NewJobDraft>) => void;
  problemFields: ReadonlySet<string>;
  compact?: boolean;
};

export function hoursChanged(draft: NewJobDraft, facts: NewJobPropertyFacts | null): boolean {
  if (!draft.hoursEdited) return false;
  const fromProperty = facts?.hours ?? null;
  return fromProperty === null ? draft.estimatedHours !== "" : Number(draft.estimatedHours) !== fromProperty;
}

export function clientPriceText(draft: NewJobDraft, facts: NewJobPropertyFacts | null): string {
  if (draft.fixedPriceOn && Number(draft.fixedPrice) >= 0 && draft.fixedPrice.trim()) return `${formatMoney(Number(draft.fixedPrice))} fixed`;
  if (!facts) return "Choose a property";
  if (facts.clientPrice.missing || facts.clientPrice.amount === null) return "Not set";
  return formatMoney(facts.clientPrice.amount);
}

export function JobTypePicker({ value, onChange }: { value: NewJobType; onChange: (type: NewJobType) => void }) {
  const more = NEW_JOB_TYPES.filter((type) => !FEATURED_JOB_TYPES.includes(type));
  const moreValue = more.includes(value) ? value : "";
  return (
    <div {...tourTarget("admin.jobs.create.service")} className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Job type">
      {FEATURED_JOB_TYPES.map((type) => (
        <ChoiceChip key={type} selected={value === type} onClick={() => onChange(type)}>{jobTypeLabel(type)}</ChoiceChip>
      ))}
      <label className="sr-only" htmlFor="new-job-more-types">More types</label>
      <ESelect
        id="new-job-more-types"
        value={moreValue}
        onChange={(event) => { if (event.target.value) onChange(event.target.value as NewJobType); }}
        className={"h-9 w-auto rounded-full text-[0.8125rem] max-sm:h-11 " + (moreValue ? "border-[hsl(var(--e-band-good-line))] bg-[hsl(var(--e-band-good-bg))]" : "")}
      >
        <option value="">More types ▾</option>
        {more.map((type) => <option key={type} value={type}>{jobTypeLabel(type)}</option>)}
      </ESelect>
    </div>
  );
}

function priceSourceText(facts: NewJobPropertyFacts, jobType: string): string {
  if (facts.clientPrice.source === "PROPERTY_RATE") return `property rate for ${jobTypeLabel(jobType)}, read when the job is invoiced`;
  if (facts.clientPrice.source === "JOBTYPE_PRICE") return `price book rate for ${jobTypeLabel(jobType)}, read when the job is invoiced`;
  return "";
}

export function WhatSection({ draft, facts, firstDay, update, problemFields, compact = false }: WhatSectionProps) {
  const data = facts.data;
  const isAirbnb = draft.jobType === "AIRBNB_TURNOVER";
  const hoursDiffer = hoursChanged(draft, data);

  return (
    <div className="space-y-3">
      <JobTypePicker value={draft.jobType} onChange={(jobType) => update({ jobType, ...(jobType !== "AIRBNB_TURNOVER" ? {} : { siteMode: "property" }) })} />
      {!data ? (
        <Faint>{facts.status === "loading" ? "Reading what the property fills in…" : facts.status === "error" ? facts.error ?? "The property could not be read." : draft.siteMode === "one_off" ? "A one-off address has no saved values; enter what this job needs." : "Choose a property to fill these in."}</Faint>
      ) : null}
      <div className={facts.stale ? "opacity-70" : undefined} aria-busy={facts.status === "loading" || undefined}>
        {data ? (
          <FactRow label="Cleaner form" mark={data.form ? <SourceMark /> : undefined}>
            {data.form ? (
              <>
                {data.form.name}, version {data.form.version}{" "}
                <Faint>· {data.form.source === "property_override" ? "the property's own form" : "the newest active one for the type"}</Faint>
              </>
            ) : (
              <span className="text-[hsl(var(--e-band-attention-fg))]">Not set: no active form for {jobTypeLabel(draft.jobType)}. The cleaner cannot fill in a form until one exists.</span>
            )}
          </FactRow>
        ) : null}
        <FactRow
          label="Pay hours"
          mark={data ? (data.hours === null && !draft.estimatedHours ? <SourceMark label="not set on the property" changed /> : <SourceMark changed={hoursDiffer} />) : undefined}
        >
          <span className="flex flex-wrap items-center gap-2">
            <label htmlFor="new-job-hours" className="sr-only">Pay hours</label>
            <EInput
              id="new-job-hours"
              type="number"
              step="0.25"
              min="0"
              inputMode="decimal"
              value={draft.estimatedHours}
              aria-invalid={problemFields.has("hours") || undefined}
              onChange={(event) => update({ estimatedHours: event.target.value, hoursEdited: true })}
              className="w-24 max-sm:text-[16px]"
            />
            <Faint>h · assigned cleaning hours. Blank pays clocked time.</Faint>
          </span>
        </FactRow>
        <FactRow
          label="Client price"
          action={
            <EButton type="button" variant="ghost" size="sm" onClick={() => update({ fixedPriceOn: !draft.fixedPriceOn })} aria-expanded={draft.fixedPriceOn}>
              {draft.fixedPriceOn ? "Use the rate" : "Fixed price…"}
            </EButton>
          }
        >
          {draft.fixedPriceOn ? (
            <span className="flex flex-col gap-2">
              <span className="flex flex-wrap items-center gap-2">
                <label htmlFor="new-job-fixed" className="text-[0.8125rem]">Fixed price $</label>
                <EInput id="new-job-fixed" type="number" min="0" step="0.01" inputMode="decimal" value={draft.fixedPrice} aria-invalid={problemFields.has("fixedPrice") || undefined}
                  onChange={(event) => update({ fixedPrice: event.target.value })} className="w-28 max-sm:text-[16px]" />
                <Faint>overrides the rate on the client invoice</Faint>
              </span>
              <label className="text-[0.8125rem]" htmlFor="new-job-invoice-note">Invoice note (optional)</label>
              <EInput id="new-job-invoice-note" value={draft.invoiceNote} onChange={(event) => update({ invoiceNote: event.target.value })} className="max-sm:text-[16px]" />
            </span>
          ) : data ? (
            data.clientPrice.missing || data.clientPrice.amount === null ? (
              <span className="text-[hsl(var(--e-band-attention-fg))]">Not set: no property rate or price book rate for {jobTypeLabel(draft.jobType)}. The job is created, but it cannot be invoiced until a rate or a fixed price is set.</span>
            ) : (
              <>
                <strong className="font-[600]">{formatMoney(data.clientPrice.amount)}</strong> per job <Faint>· {priceSourceText(data, draft.jobType)}</Faint>
              </>
            )
          ) : (
            <Faint>Choose a property</Faint>
          )}
        </FactRow>
        {data ? (
          <FactRow label="Cleaner pay" mark={data.cleanerPay.rate !== null ? <SourceMark /> : undefined}>
            {data.cleanerPay.rate !== null ? (
              <>
                <strong className="font-[600]">{formatMoney(data.cleanerPay.rate)}</strong> an hour{" "}
                <Faint>· {data.cleanerPay.basis === "preferred_cleaner_rate" ? "the preferred cleaner's rate for this type" : "property cleaner rate"}, saved on the assignment when someone is assigned</Faint>
              </>
            ) : (
              <Faint>Not set here: pay falls back to the cleaner&apos;s own rate, then the default rate, when someone is assigned.</Faint>
            )}
          </FactRow>
        ) : null}
        {data && !compact ? (
          <FactRow label="Access" mark={data.access.hasGuide || data.access.keyLocation ? <SourceMark /> : undefined}>
            {data.access.hasGuide
              ? `Access guide with ${data.access.guideEntries} step${data.access.guideEntries === 1 ? "" : "s"} and ${data.access.guidePhotos} photo${data.access.guidePhotos === 1 ? "" : "s"}`
              : data.access.keyLocation
                ? `Key: ${data.access.keyLocation}`
                : "No access guide on the property"}
            <Faint> · the cleaner sees codes from accepting until the day after the clean</Faint>
          </FactRow>
        ) : null}
        {data ? (
          <FactRow label="Open tasks" mark={data.carryForward.count > 0 ? <SourceMark label="carried forward" changed /> : undefined}>
            {data.carryForward.count === 0 ? (
              <Faint>No open property tasks.</Faint>
            ) : firstDay?.carryForwardAttaches === "no" ? (
              <>
                {data.carryForward.count} property task{data.carryForward.count === 1 ? "" : "s"} wait for the property&apos;s next job; an earlier job there takes them, not this one.
              </>
            ) : (
              <>
                {data.carryForward.count} property task{data.carryForward.count === 1 ? "" : "s"} will be added{firstDay ? "" : " if this is the property's next job"}: <strong className="font-[600]">{data.carryForward.titles.slice(0, 3).join(", ")}</strong>
                {data.carryForward.count > 3 ? ` and ${data.carryForward.count - 3} more` : ""}
              </>
            )}
          </FactRow>
        ) : null}
        {data && isAirbnb && !data.property.laundryEnabled ? <Faint>Laundry is off for this property.</Faint> : null}
      </div>
      {data ? (
        <p className="text-[0.75rem] text-[hsl(var(--e-text-secondary))]">
          Change any value; it applies to this job only. Rates are edited on the <Link className="underline" href={`/v2/admin/properties/${encodeURIComponent(data.property.id)}`}>property</Link>.
        </p>
      ) : null}
    </div>
  );
}
