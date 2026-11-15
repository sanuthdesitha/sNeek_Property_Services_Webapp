import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { getAppSettings } from "@/lib/settings";
import { DamageRecordPage } from "@/components/v2/admin/damage/damage-record";

export const metadata = { title: "Damage report · Estate admin" };
export const dynamic = "force-dynamic";

/**
 * Damage report record page (board "Damage report", 2026-11-14). Same role
 * gate as before (ADMIN and OPS_MANAGER; the Cases ops pack applies through
 * middleware and again on every API call). Estimates, release, take back,
 * close and send back live here; the client portal keeps its own page.
 * The job is read only for the back link of a report that cannot be shown.
 */
export default async function V2AdminDamageReportPage({ params }: { params: { reportId: string } }) {
  await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
  const [settings, row] = await Promise.all([
    getAppSettings().catch(() => null),
    db.damageReport.findUnique({ where: { id: params.reportId }, select: { job: { select: { id: true, jobNumber: true } } } }).catch(() => null),
  ]);
  return (
    <DamageRecordPage
      key={params.reportId}
      reportId={params.reportId}
      timeZone={settings?.timezone || "Australia/Sydney"}
      jobId={row?.job.id ?? null}
      jobNumber={row?.job.jobNumber ?? null}
    />
  );
}
