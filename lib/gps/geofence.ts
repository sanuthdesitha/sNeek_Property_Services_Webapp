import { db } from "@/lib/db";
import { JobStatus } from "@prisma/client";
import { haversine, DEFAULT_GEOFENCE_RADIUS_M } from "./distance";

export { haversine, DEFAULT_GEOFENCE_RADIUS_M } from "./distance";

export interface GeofenceCheckInput {
  userId: string;
  lat: number;
  lng: number;
  pingAt: Date;
  radiusM?: number;
}

export interface GeofenceCheckResult {
  arrived?: { jobId: string };
  /** Latest ping is outside the fence on a job the cleaner had reached. */
  departed?: { jobId: string; distanceM: number };
  /** Fresh inside-fence ping on a job previously marked departed (re-entry). */
  reentered?: { jobId: string };
}

/**
 * Given a fresh ping, check if the cleaner has arrived at (or departed from)
 * their currently-active assigned job's property. Sets Job.arrivedAt the first
 * time a ping lands inside the geofence radius, and clears Job.departedAt on
 * re-entry. A single outside ping only SIGNALS a possible departure — the
 * caller runs the multi-ping confirmation in lib/gps/departure.ts before
 * persisting Job.departedAt / clocking anyone out.
 *
 * PAUSED is included so a paused job's cleaner walking off still gets a
 * truthful departedAt stamp (no clock-out — there's no open log to close).
 */
export async function checkGeofenceForPing(input: GeofenceCheckInput): Promise<GeofenceCheckResult> {
  const radius = input.radiusM ?? DEFAULT_GEOFENCE_RADIUS_M;

  const activeAssignment = await db.jobAssignment.findFirst({
    where: {
      userId: input.userId,
      removedAt: null,
      job: {
        status: {
          in: [JobStatus.IN_PROGRESS, JobStatus.EN_ROUTE, JobStatus.ASSIGNED, JobStatus.PAUSED],
        },
      },
    },
    include: {
      job: {
        include: {
          property: {
            select: { latitude: true, longitude: true },
          },
        },
      },
    },
  });

  if (!activeAssignment?.job) return {};
  const { job } = activeAssignment;
  const lat = job.property?.latitude;
  const lng = job.property?.longitude;
  if (lat == null || lng == null) return {};

  const distance = haversine(input.lat, input.lng, lat, lng);
  const within = distance <= radius;

  if (within) {
    // Re-entry: a confirmed inside-fence ping on a job marked departed clears
    // departedAt (resuming the job itself stays a manual action).
    if (job.departedAt) {
      await db.job.update({
        where: { id: job.id },
        data: { departedAt: null, ...(job.arrivedAt ? {} : { arrivedAt: input.pingAt }) },
      });
      return { reentered: { jobId: job.id }, ...(job.arrivedAt ? {} : { arrived: { jobId: job.id } }) };
    }
    if (!job.arrivedAt) {
      await db.job.update({
        where: { id: job.id },
        data: { arrivedAt: input.pingAt },
      });
      return { arrived: { jobId: job.id } };
    }
    return {};
  }

  // Outside the fence on a job the cleaner had reached — signal a POSSIBLE
  // departure. The caller confirms it against the recent ping history
  // (lib/gps/departure.ts) before persisting anything.
  if (job.arrivedAt) {
    return { departed: { jobId: job.id, distanceM: Math.round(distance) } };
  }

  return {};
}
