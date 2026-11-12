/**
 * The job page's tabs for heavy content: Form answers, Photos, Clock and GPS,
 * Messages, History. Each renders the existing component that owned it on
 * the old page (submission review, media gallery, clock/GPS editors and map,
 * client chat, audit trail). A tab's content is only rendered when chosen.
 */
import { formatInTimeZone } from "date-fns-tz";
import type { ReactNode } from "react";
import { ClockLocationsMap } from "@/components/shared/clock-locations-map";
import type { JobPageView } from "@/lib/jobs/job-page/deep-link";
import { HISTORY_LIMIT } from "@/lib/jobs/job-page/load";
import { ClockRecordsEditor, GpsRecordEditor } from "../job-clock-gps-editor";
import { JobChatAdmin } from "../job-chat-admin";
import { AccessMediaGallery, SubmissionReview } from "../submission-review";
import { titleCase, type JobPageData } from "./job-page-data";

function Panel({ title, children, id }: { title: string; children: ReactNode; id?: string }) {
  return (
    <section id={id} aria-label={title} className="min-w-0 scroll-mt-24 rounded-[var(--e-radius-lg)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface))] p-4 text-[0.8125rem]">
      {children}
    </section>
  );
}

function PhotosTab({ data }: { data: JobPageData }) {
  const latest = data.submissionRows[0] ?? null;
  const taskProof = data.taskRows.flatMap((task) => (task.proof ?? []).map((proof) => ({ ...proof, label: proof.label ?? task.title })));
  const laundry = data.job.laundryTask;
  const laundryImages = laundry
    ? [
        laundry.pickupKeyPhotoUrl ? { id: "laundry-pickup", url: laundry.pickupKeyPhotoUrl, s3Key: null, label: "Key at pickup" } : null,
        laundry.dropoffKeyPhotoUrl ? { id: "laundry-dropoff", url: laundry.dropoffKeyPhotoUrl, s3Key: null, label: "Key returned at drop-off" } : null,
        laundry.receiptImageUrl ? { id: "laundry-receipt", url: laundry.receiptImageUrl, s3Key: null, label: "Drop-off receipt" } : null,
      ].filter((item): item is { id: string; url: string; s3Key: null; label: string } => item !== null)
    : [];
  const empty = !latest?.media.length && taskProof.length === 0 && laundryImages.length === 0;
  return (
    <Panel title="Photos">
      {empty ? <p className="text-[hsl(var(--e-muted-foreground))]">No photos on this job yet.</p> : null}
      {latest && latest.media.length > 0 ? (
        <div className="space-y-2">
          <h2 className="text-[0.875rem] font-[600]">Submission photos ({latest.media.length})</h2>
          <AccessMediaGallery jobId={data.job.id} media={latest.media} title="Submission photos" />
        </div>
      ) : null}
      {taskProof.length > 0 ? (
        <div className="mt-4 space-y-2">
          <h2 className="text-[0.875rem] font-[600]">Task evidence ({taskProof.length})</h2>
          <AccessMediaGallery jobId={data.job.id} media={taskProof} title="Task evidence" />
        </div>
      ) : null}
      {laundryImages.length > 0 ? (
        <div className="mt-4 space-y-2">
          <h2 className="text-[0.875rem] font-[600]">Laundry ({laundryImages.length})</h2>
          <AccessMediaGallery jobId={data.job.id} media={laundryImages} title="Laundry photos" />
        </div>
      ) : null}
      {data.submissionRows.length > 1 ? (
        <p className="mt-3 text-[hsl(var(--e-muted-foreground))]">Earlier submissions keep their photos in Form answers.</p>
      ) : null}
    </Panel>
  );
}

function ClockTab({ data }: { data: JobPageData }) {
  const { job } = data;
  return (
    <Panel title="Clock and GPS">
      <div className="space-y-3">
        <ClockRecordsEditor
          jobId={job.id}
          timeLogs={job.timeLogs.map((log) => ({
            id: log.id,
            startedAt: log.startedAt.toISOString(),
            stoppedAt: log.stoppedAt?.toISOString() ?? null,
            durationM: log.durationM,
            userName: log.user?.name ?? log.user?.email ?? "Cleaner",
          }))}
        />
        {job.gpsCheckInLat != null || job.gpsCheckOutLat != null ? (
          <ClockLocationsMap
            property={{ lat: job.property?.latitude ?? null, lng: job.property?.longitude ?? null, name: job.property?.name ?? null }}
            checkIn={job.gpsCheckInLat != null && job.gpsCheckInLng != null ? { lat: job.gpsCheckInLat, lng: job.gpsCheckInLng, at: job.gpsCheckInAt?.toISOString() ?? null, accuracy: job.gpsCheckInAccuracyM } : null}
            checkOut={job.gpsCheckOutLat != null && job.gpsCheckOutLng != null ? { lat: job.gpsCheckOutLat, lng: job.gpsCheckOutLng, at: job.gpsCheckOutAt?.toISOString() ?? null } : null}
            distanceMeters={job.gpsDistanceMeters}
          />
        ) : null}
        <GpsRecordEditor
          jobId={job.id}
          gps={{
            checkInLat: job.gpsCheckInLat,
            checkInLng: job.gpsCheckInLng,
            checkInAt: job.gpsCheckInAt?.toISOString() ?? null,
            checkInAccuracyM: job.gpsCheckInAccuracyM,
            checkOutLat: job.gpsCheckOutLat,
            checkOutLng: job.gpsCheckOutLng,
            checkOutAt: job.gpsCheckOutAt?.toISOString() ?? null,
            distanceMeters: job.gpsDistanceMeters,
            adjusted: job.gpsCheckInAdjusted,
            reasonCode: job.gpsCheckInReasonCode,
            note: job.gpsCheckInNote,
          }}
        />
      </div>
    </Panel>
  );
}

function HistoryTab({ data }: { data: JobPageData }) {
  const rows = data.related.auditRows;
  const total = data.related.auditCount;
  return (
    <Panel title="History">
      {rows === null ? (
        <p role="alert">The audit trail could not be loaded. Reload the page to try again.</p>
      ) : rows.length === 0 ? (
        <p className="text-[hsl(var(--e-muted-foreground))]">No audit entries for this job yet.</p>
      ) : (
        <>
          {total !== null && total > rows.length ? <p className="mb-2 text-[hsl(var(--e-muted-foreground))]">Showing the latest {HISTORY_LIMIT} of {total} entries.</p> : null}
          <ul className="divide-y divide-[hsl(var(--e-border))]">
            {rows.map((row) => (
              <li key={row.id} className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 py-2">
                <span className="min-w-0">
                  <span className="font-[550]">{titleCase(row.action)}</span>
                  <span className="text-[hsl(var(--e-muted-foreground))]"> · {row.entity}</span>
                  <span className="block text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">{row.user?.name ?? row.user?.email ?? "System"}</span>
                </span>
                <span className="text-[0.75rem] tabular-nums text-[hsl(var(--e-muted-foreground))]">{formatInTimeZone(row.createdAt, data.timeZone, "dd MMM yyyy HH:mm")}</span>
              </li>
            ))}
          </ul>
        </>
      )}
    </Panel>
  );
}

export function JobHeavyTab({ view, data }: { view: Exclude<JobPageView, "timeline">; data: JobPageData }) {
  switch (view) {
    case "answers":
      return (
        <Panel title="Form answers">
          <SubmissionReview jobId={data.job.id} submissions={data.submissionRows} property={data.related.propertyRecord} reworkFlags={data.model.reworkFlags} />
        </Panel>
      );
    case "photos":
      return <PhotosTab data={data} />;
    case "clock":
      return <ClockTab data={data} />;
    case "messages":
      // #chat stays the deep-link target from the approvals "Client requests" queue.
      return (
        <Panel title="Messages" id="chat">
          <JobChatAdmin jobId={data.job.id} />
        </Panel>
      );
    case "history":
      return <HistoryTab data={data} />;
  }
}
