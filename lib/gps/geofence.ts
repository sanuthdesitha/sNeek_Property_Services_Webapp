import { db } from "@/lib/db";
import { isTrackedStatus } from "./tracked-statuses";
import { judgeFix } from "./geofence-policy";

export { haversine, DEFAULT_GEOFENCE_RADIUS_M } from "./distance";

export interface GeofenceCheckInput {
  userId: string;
  /**
   * The job the ping was filed against (already checked by the tracking
   * window). The geofence judges THIS job's property — it used to pick an
   * arbitrary assignment of the cleaner (including later ASSIGNED jobs), so on
   * a multi-job day departures were judged against the wrong address.
   */
  jobId: string;
  lat: number;
  lng: number;
  /** Reported accuracy in metres; a fix coarser than 60 m judges nothing. */
  accuracy?: number | null;
  pingAt: Date;
}

export interface GeofenceCheckResult {
  arrived?: { jobId: string };
  /** Latest ping is confidently outside the fence on a job the cleaner had reached. */
  departed?: { jobId: string; distanceM: number };
  /** Fresh inside-fence ping on a job previously marked departed (re-entry). */
  reentered?: { jobId: string };
}

/**
 * Given a fresh ping on a tracked job, stamp arrival the first time an
 * ACCURATE fix lands inside the property's fence, clear `departedAt` on
 * re-entry, and SIGNAL a possible departure when an accurate fix is beyond the
 * fence plus hysteresis. The caller confirms a departure against recent ping
 * history (lib/gps/departure.ts) before persisting anything.
 *
 * Radius, accuracy and hysteresis come from lib/gps/geofence-policy, shared
 * with Live ops so the office and the clock-out agree on "inside".
 */
export async function checkGeofenceForPing(input: GeofenceCheckInput): Promise<GeofenceCheckResult> {
  const assignment = await db.jobAssignment.findFirst({
    where: { userId: input.userId, jobId: input.jobId, removedAt: null },
    select: {
      job: {
        select: {
          id: true,
          status: true,
          arrivedAt: true,
          departedAt: true,
          property: { select: { latitude: true, longitude: true, geofenceRadiusM: true } },
        },
      },
    },
  });
  const job = assignment?.job;
  if (!job || !isTrackedStatus(job.status)) return {};

  const judgement = judgeFix({ lat: input.lat, lng: input.lng, accuracy: input.accuracy ?? null }, job.property);
  if (judgement.verdict === "INSIDE") {
    if (job.departedAt) {
      await db.job.update({
        where: { id: job.id },
        data: { departedAt: null, ...(job.arrivedAt ? {} : { arrivedAt: input.pingAt }) },
      });
      return { reentered: { jobId: job.id }, ...(job.arrivedAt ? {} : { arrived: { jobId: job.id } }) };
    }
    if (!job.arrivedAt) {
      await db.job.update({ where: { id: job.id }, data: { arrivedAt: input.pingAt } });
      return { arrived: { jobId: job.id } };
    }
    return {};
  }

  if (judgement.verdict === "OUTSIDE" && job.arrivedAt && judgement.distanceM != null) {
    return { departed: { jobId: job.id, distanceM: Math.round(judgement.distanceM) } };
  }
  return {};
}
