import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { listSuppressed, MARKETING_OPT_OUT } from "@/lib/email/suppression";
import { readSystemHealth } from "@/lib/ops/system-health";
import { SystemHealthScreen } from "@/components/v2/admin/diagnostics/system-health-screen";
import { resolveHealthTab } from "@/components/v2/admin/diagnostics/health-tabs";
import type { EmailRow } from "@/components/v2/admin/diagnostics/diagnostics-hub";

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

  const [view, listed, suppressedUsers, uploadFailures] = await Promise.all([
    readSystemHealth().catch(() => null),
    // The address-keyed bounce list (what sends check first), without campaign opt-outs.
    db.emailSuppression
      .findMany({ where: { reason: { not: MARKETING_OPT_OUT } }, orderBy: { createdAt: "desc" }, take: 200, select: { email: true, reason: true, createdAt: true } })
      .catch(() => []),
    // Accounts whose own email status is not OK (the list this tab showed before).
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

  const email: EmailRow[] = listed.map((row) => ({ email: row.email, reason: row.reason, createdAt: row.createdAt.toISOString() }));
  const seen = new Set(email.map((row) => row.email.toLowerCase()));
  for (const user of suppressedUsers) {
    if (seen.has(user.email.toLowerCase())) continue;
    seen.add(user.email.toLowerCase());
    email.push({ email: user.email, reason: user.status, createdAt: null });
  }

  const uploads = uploadFailures.map((failure) => ({
    id: failure.id,
    reason: failure.reason ?? failure.message ?? "Upload failed",
    occurredAt: failure.occurredAt ? failure.occurredAt.toISOString() : null,
    user: failure.user ? failure.user.name || failure.user.email : null,
    job: failure.job?.jobNumber ?? null,
  }));

  return <SystemHealthScreen initialView={view} tab={tab} email={email} uploads={uploads} />;
}
