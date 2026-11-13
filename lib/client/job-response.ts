import type { ClientPortalContext } from "@/lib/auth/client-portal";

export const STALE_CLIENT_LOCATION_MS = 2 * 60 * 1000;

type ClientJobProjection = {
  status: string;
  cleanerLocationPings: Array<{ lat: number; lng: number; accuracy: number | null; heading: number | null; speed: number | null; timestamp: Date }>;
  property: {
    latitude: number | null;
    longitude: number | null;
    showCleanerContactToClient: boolean;
    /** The client's live-location switch (Client.showCleanerLiveLocation; off by default). */
    client?: { showCleanerLiveLocation: boolean } | null;
  };
  assignments: Array<{ isPrimary: boolean; user: { id: string; name: string | null; image: string | null; phone: string | null } }>;
  report: { clientVisible: boolean; pdfUrl: string | null } | null;
  invoiceLines: unknown[];
  laundryTask: { confirmations: Array<{ notes: string | null }> } | null;
  auditLogs: Array<{ user: { name: string | null } | null }>;
};

/**
 * Invoice lines (charged amounts) on a clean are finance: shown only when the
 * client's finance module is switched on AND the viewer is the account holder
 * or an assistant with the invoice grant. One rule for the job API and the
 * clean page (owner decision 2026-11-13).
 */
export function clientMaySeeJobCosts(portal: {
  actor: ClientPortalContext["actor"];
  permissions: Pick<ClientPortalContext["permissions"], "invoicesView">;
  visibility: Pick<ClientPortalContext["visibility"], "showFinanceDetails">;
}): boolean {
  return portal.visibility.showFinanceDetails === true && (portal.actor === "CLIENT" || portal.permissions.invoicesView === true);
}

/** The per-client live-location switch; anything but an explicit true is off. */
export function clientSeesCleanerLocation(job: { property: { client?: { showCleanerLiveLocation: boolean } | null } }): boolean {
  return job.property.client?.showCleanerLiveLocation === true;
}

/** Apply portal visibility and actor grants before serializing either client UI's job response. */
export function projectClientJob<T extends ClientJobProjection>(
  job: T,
  portal: Pick<ClientPortalContext, "actor" | "permissions" | "visibility">,
  progressPercent: number | null,
  now = Date.now(),
) {
  const { cleanerLocationPings, ...publicJob } = job;
  const ping = cleanerLocationPings.find((entry) => {
    const timestamp = entry.timestamp.getTime();
    return timestamp <= now && timestamp >= now - STALE_CLIENT_LOCATION_MS;
  });
  const showNames = portal.visibility.showCleanerNames;
  const showReports = portal.visibility.showReports && (portal.actor === "CLIENT" || portal.permissions.reports);
  return {
    ...publicJob,
    progressPercent,
    // The cleaner's position reaches the client only while they are on the
    // way AND the office switched live location on for this client (off by
    // default; the cleaner's screen says so when it is on). ETA and status
    // fields are unaffected.
    liveTrip: job.status === "EN_ROUTE" && clientSeesCleanerLocation(job) ? {
      cleanerLat: ping?.lat ?? null,
      cleanerLng: ping?.lng ?? null,
      accuracy: ping?.accuracy ?? null,
      heading: ping?.heading ?? null,
      speed: ping?.speed ?? null,
      lastPingAt: ping?.timestamp ?? null,
      propertyLat: job.property.latitude,
      propertyLng: job.property.longitude,
    } : null,
    assignments: showNames ? job.assignments.map((assignment) => ({
      ...assignment,
      user: {
        id: assignment.user.id,
        name: assignment.user.name,
        image: assignment.user.image,
        ...(job.property.showCleanerContactToClient ? { phone: assignment.user.phone } : {}),
      },
    })) : [],
    report: showReports && (job.status === "COMPLETED" || job.status === "INVOICED") && job.report?.clientVisible ? {
      ...job.report,
      pdfUrl: portal.visibility.showReportDownloads ? job.report.pdfUrl : null,
    } : null,
    invoiceLines: clientMaySeeJobCosts(portal) ? job.invoiceLines : [],
    laundryTask: portal.visibility.showLaundryUpdates && job.laundryTask ? {
      ...job.laundryTask,
      confirmations: job.laundryTask.confirmations.map((confirmation) => ({
        ...confirmation,
        // Legacy notes may contain arbitrary JSON, including financial amounts.
        notes: portal.visibility.showLaundryCosts ? confirmation.notes : null,
      })),
    } : null,
    auditLogs: job.auditLogs.map((entry) => ({ ...entry, user: showNames ? entry.user : null })),
  };
}
