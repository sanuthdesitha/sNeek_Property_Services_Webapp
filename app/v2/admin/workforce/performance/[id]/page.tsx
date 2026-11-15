import Link from "next/link";
import { notFound } from "next/navigation";
import { Role } from "@prisma/client";
import { formatInTimeZone } from "date-fns-tz";
import { db } from "@/lib/db";
import { requireRole } from "@/lib/auth/session";
import { getAppSettings } from "@/lib/settings";
import { getUserExtendedProfiles } from "@/lib/accounts/user-details";
import { PERFORMANCE_WINDOWS, loadPerformanceWindow } from "@/lib/workforce/performance-window";
import { EButton, EPageHeader } from "@/components/v2/ui/primitives";
import { PerformanceView } from "@/components/v2/admin/workforce/performance-view";
import { prettify } from "@/components/v2/admin/workforce/utils";

export const metadata = { title: "Performance · Workforce" };
export const dynamic = "force-dynamic";

/**
 * Cleaner performance (board "Workforce" › Cleaner performance page). Opened
 * from Roster, the person page's "Full performance" and Quality. Each window
 * is worked out with a time limit; one that does not finish is shown as "not
 * worked out" with its own retry, never as zeros.
 */
export default async function EstatePerformanceDetailPage({ params }: { params: { id: string } }) {
  await requireRole([Role.ADMIN, Role.OPS_MANAGER, Role.QA_INSPECTOR]);

  const user = await db.user.findUnique({
    where: { id: params.id },
    select: { id: true, name: true, email: true, phone: true, role: true, isActive: true, createdAt: true, extraRoles: { select: { role: true } } },
  });
  if (!user) notFound();

  const [windows, settings, profiles] = await Promise.all([
    Promise.all(PERFORMANCE_WINDOWS.map((days) => loadPerformanceWindow(user.id, days))),
    getAppSettings().catch(() => null),
    getUserExtendedProfiles([user.id]).catch(() => null),
  ]);
  const timeZone = settings?.timezone || "Australia/Sydney";
  const base = profiles?.get?.(user.id)?.baseLocation ?? null;
  const roles = [user.role, ...user.extraRoles.map((row) => row.role)].map((role) => (role === Role.QA_INSPECTOR ? "QA inspector" : prettify(role.toLowerCase()))).join(" + ");
  const facts = [
    roles,
    base,
    user.phone,
    `since ${formatInTimeZone(user.createdAt, timeZone, "MMM yyyy")}`,
    user.isActive ? null : "inactive",
  ].filter(Boolean).join(" · ");

  return (
    <div className="space-y-5">
      <Link href="/v2/admin/workforce/roster" className="inline-flex min-h-11 items-center text-[0.8125rem] font-[550] text-[hsl(var(--e-primary))] underline-offset-2 hover:underline">
        ‹ Workforce · Roster
      </Link>
      <EPageHeader
        eyebrow="Workforce · Performance"
        title={`${user.name ?? user.email}, performance`}
        description={`${facts}. Figures cover their finished jobs scheduled in each window (Sydney days); attendance covers past jobs. Each figure says what it was worked out over.`}
        actions={
          <>
            <EButton asChild variant="outline" size="sm"><Link href={`/v2/admin/accounts/users/${user.id}`}>Account</Link></EButton>
            <EButton asChild variant="outline" size="sm"><Link href="/v2/admin/workforce/coaching">New coaching record…</Link></EButton>
          </>
        }
      />
      <PerformanceView userId={user.id} initial={windows} />
    </div>
  );
}
