/**
 * 1 · Booking — the arriving guest first (who the property is prepared for),
 * the departing booking demoted beneath it, client-facing notes, the schedule
 * line and, when a skip is requested or set, its decision. Moved from the old
 * Overview and Schedule tabs.
 */
import { formatInTimeZone } from "date-fns-tz";
import { Phone } from "lucide-react";
import { EBadge } from "@/components/v2/ui/primitives";
import { buildGuestCountLabel, telHref } from "@/lib/jobs/guest-summary";
import type { TimelineStage } from "@/lib/jobs/job-page/timeline";
import { JobDetailManage } from "../job-detail-reviews";
import { JobDisclosure } from "./job-disclosure";
import type { JobPageData } from "./job-page-data";
import { Muted, StageSection, StageShell } from "./stage-shell";

function when(value: Date | string | null | undefined, timeZone: string, pattern: string): string | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : formatInTimeZone(date, timeZone, pattern);
}

function ArrivingGuest({ data }: { data: JobPageData }) {
  const guest = data.model.nextGuest;
  if (!guest.hasAnything) {
    return (
      <StageSection className="grow basis-64">
        <Muted>No incoming booking on the feed for this turnover.</Muted>
      </StageSection>
    );
  }
  const preparing = guest.preparationGuestCount != null ? `prepare for ${guest.preparationGuestCount}${guest.preparationIsFallback ? " (property max, no booking count)" : ""}` : null;
  return (
    <StageSection className="grow basis-64">
      <div className="flex flex-wrap items-center gap-2">
        <EBadge tone="success" soft>Arriving next</EBadge>
        <span className="tabular-nums text-[hsl(var(--e-muted-foreground))]">{when(guest.checkinAtLocal, data.timeZone, "d MMM HH:mm")}</span>
      </div>
      <p className="font-[600]">{guest.name ?? "Guest"}</p>
      <p className="text-[hsl(var(--e-muted-foreground))] [overflow-wrap:anywhere]">
        {[guest.country, guest.guestCountLabel, preparing].filter(Boolean).join(" · ")}
        {guest.reservationCode ? <> · code <span className="tabular-nums">{guest.reservationCode}</span></> : null}
      </p>
      <div className="flex flex-wrap items-center gap-3">
        {guest.phone ? (
          <a href={`tel:${guest.phone}`} className="inline-flex min-h-11 items-center gap-1.5 font-[550] text-[hsl(var(--e-accent-portal))] hover:underline">
            <Phone aria-hidden className="h-3.5 w-3.5" /> {guest.phoneLabel}
          </a>
        ) : null}
        {guest.email ? <a href={`mailto:${guest.email}`} className="text-[hsl(var(--e-muted-foreground))] hover:underline">{guest.email}</a> : null}
        {guest.profileUrl ? <a href={guest.profileUrl} target="_blank" rel="noreferrer" className="text-[hsl(var(--e-accent-portal))] hover:underline">Guest profile</a> : null}
      </div>
    </StageSection>
  );
}

function DepartingGuest({ data }: { data: JobPageData }) {
  const reservation = data.job.reservation;
  if (!reservation) return null;
  const tel = telHref(reservation.guestPhone);
  const count = buildGuestCountLabel({ adults: reservation.adults, children: reservation.children, infants: reservation.infants });
  const checkout = when(reservation.checkoutAtLocal, data.timeZone, "d MMM HH:mm") ?? when(reservation.endDate, "UTC", "d MMM");
  return (
    <StageSection className="grow basis-64">
      <div className="flex flex-wrap items-center gap-2">
        <EBadge tone="neutral" soft>Departing</EBadge>
        <span className="tabular-nums text-[hsl(var(--e-muted-foreground))]">{checkout}</span>
      </div>
      <p className="font-[600]">{reservation.guestName ?? "Guest"}</p>
      <p className="text-[hsl(var(--e-muted-foreground))]">
        {count ? `${count} · ` : ""}
        {tel ? <a href={`tel:${tel}`} className="font-[550] text-[hsl(var(--e-accent-portal))] hover:underline">{reservation.guestPhone}</a> : reservation.guestPhone ?? "No phone number on the booking"}
        {reservation.guestEmail ? <> · <a href={`mailto:${reservation.guestEmail}`} className="hover:underline">{reservation.guestEmail}</a></> : null}
      </p>
      <JobDisclosure id="departing-booking" label="Departing booking details" description="Dates, code, source and UID from the calendar feed.">
        <div className="space-y-1 text-[hsl(var(--e-muted-foreground))]">
          <p className="tabular-nums">{when(reservation.startDate, "UTC", "d MMM yyyy")} → {when(reservation.endDate, "UTC", "d MMM yyyy")}</p>
          {reservation.reservationCode ? <p>Code <span className="tabular-nums">{reservation.reservationCode}</span></p> : null}
          {reservation.summary ? <p>{reservation.summary}</p> : null}
          {reservation.locationText ? <p>{reservation.locationText}</p> : null}
          {reservation.source ? <EBadge tone="neutral" soft>{reservation.source}</EBadge> : null}
          <p className="break-all text-[0.6875rem]">UID {reservation.uid}</p>
        </div>
      </JobDisclosure>
    </StageSection>
  );
}

export function StageBooking({ data, stage, collapsed }: { data: JobPageData; stage: TimelineStage; collapsed: boolean }) {
  const { job } = data;
  const skipStatus = data.model.skipStatus;
  return (
    <StageShell stage={stage} collapsed={collapsed}>
      <p>
        <span className="font-[550]">{data.scheduledLabel}</span> <Muted>· {data.timeLabel}</Muted>
        {job.estimatedHours != null ? <Muted> · allocated {job.estimatedHours} h{job.actualHours != null ? `, actual ${job.actualHours} h` : ""}</Muted> : null}
        {job.completedAt ? <Muted> · completed {when(job.completedAt, data.timeZone, "d MMM yyyy")}</Muted> : null}
        {job.sameDayCheckin ? <> <EBadge tone="warning" soft>Same-day check-in{job.sameDayCheckinTime ? ` ${job.sameDayCheckinTime}` : ""}</EBadge></> : null}
      </p>
      <div className="flex flex-wrap items-stretch gap-2">
        <ArrivingGuest data={data} />
        <DepartingGuest data={data} />
      </div>
      {job.notes ? (
        <p className="[overflow-wrap:anywhere]">
          <Muted>Client-facing notes:</Muted> {job.notes}
        </p>
      ) : null}
      {skipStatus !== "NONE" && job.status !== "CANCELLED" ? (
        <JobDisclosure
          id="skip"
          label={skipStatus === "REQUESTED" ? "The client asked to skip this clean" : "This clean is skipped"}
          description="Approve, decline or restore. The job stays on record either way."
          defaultOpen={skipStatus === "REQUESTED"}
        >
          <JobDetailManage job={data.manageJob} section="skip" />
        </JobDisclosure>
      ) : null}
    </StageShell>
  );
}
