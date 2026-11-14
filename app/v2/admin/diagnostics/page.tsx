import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { listSuppressed } from "@/lib/email/suppression";
import { readSystemHealth } from "@/lib/ops/system-health";
import { SystemHealthScreen } from "@/components/v2/admin/diagnostics/system-health-screen";
import { resolveHealthTab } from "@/components/v2/admin/diagnostics/health-tabs";

export const metadata = { title: "System health · Estate admin" };
export const dynamic = "force-dynamic";

/**
 * System health (was "Diagnostics"; the URL and its ?tab= links are kept).
 * ADMIN only, as before: operations managers do not see it in their menu and
 * a shared link opens the access page with the reason.
 */
export default async function DiagnosticsPage({ searchParams }: { searchParams?: { tab?: string } }) {
  await requireRole([Role.ADMIN]);
  const tab = resolveHealthTab(searchParams?.tab);

  const [view, suppressed, uploadFailures] = await Promise.all([
    readSystemHealth().catch(() => null),
    listSuppressed(200).catch(() => []),
    db.uploadFailure
      .findMany({
        where: { resolvedAt: null },
        orderBy: { occurredAt: "desc" },
        take: 100,
        include: {
          user: { select: { name: true, email: true } },
          job: { select: { jobNumber: true } },
        },
      })
      .catch(() => []),
  ]);

  const email = suppressed.map((row: { email: string; reason?: string | null; createdAt?: Date | string | null }) => ({
    email: row.email,
    reason: row.reason ?? null,
    createdAt: row.createdAt ? new Date(row.createdAt).toISOString() : null,
  }));

  const uploads = uploadFailures.map((failure) => ({
    id: failure.id,
    reason: failure.reason ?? failure.message ?? "Upload failed",
    occurredAt: failure.occurredAt ? failure.occurredAt.toISOString() : null,
    user: failure.user ? failure.user.name || failure.user.email : null,
    job: failure.job?.jobNumber ?? null,
  }));

  return <SystemHealthScreen initialView={view} tab={tab} email={email} uploads={uploads} />;
}
