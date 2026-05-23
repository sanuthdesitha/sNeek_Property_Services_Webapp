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
  departed?: { jobId: string };
}

/**
 * Given a fresh ping, check if the cleaner has arrived at (or departed from)
 * their currently-active assigned job's property. Sets Job.arrivedAt the first
 * time a ping lands inside the geofence radius. Departure is reported back to
 * the caller but not persisted (no Job.departedAt column today — best-effort).
 */
export async function checkGeofenceForPing(input: GeofenceCheckInput): Promise<GeofenceCheckResult> {
  const radius = input.radiusM ?? DEFAULT_GEOFENCE_RADIUS_M;

  const activeAssignment = await db.jobAssignment.findFirst({
    where: {
      userId: input.userId,
      removedAt: null,
      job: {
        status: { in: [JobStatus.IN_PROGRESS, JobStatus.EN_ROUTE, JobStatus.ASSIGNED] },
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

  if (within && !job.arrivedAt) {
    await db.job.update({
      where: { id: job.id },
      data: { arrivedAt: input.pingAt },
    });
    return { arrived: { jobId: job.id } };
  }

  // Departure is best-effort: we can detect it (was previously arrived, now far
  // away) but there is no Job.departedAt column yet, so we just signal it back.
  if (!within && job.arrivedAt) {
    return { departed: { jobId: job.id } };
  }

  return {};
}
