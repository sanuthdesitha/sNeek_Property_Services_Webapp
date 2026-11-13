import { notFound } from "next/navigation";
import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { can } from "@/lib/rbac/can";
import { getAppSettings } from "@/lib/settings";
import { sydneyTodayKey } from "@/lib/time/sydney-range";
import { LAUNDRY_SKIP_REASONS } from "@/lib/laundry/constants";
import { loadLaundryRunPage } from "@/lib/laundry/run-page-load";
import { LaundryRunPage } from "@/components/v2/admin/laundry/run/laundry-run-page";
import type { RunPanelTask } from "@/components/v2/admin/laundry/laundry-run-panel";

export const metadata = { title: "Laundry run · Estate admin" };
export const dynamic = "force-dynamic";

/**
 * Laundry run full page (board LaundryRunDetail, owner request 2026-11-14):
 * breadcrumb, title with status, stage bar with the off-track states, key
 * facts, one primary action chosen by state, a More menu with a Danger zone,
 * the run as one timeline (Cleaner handoff → Invoice) and a right rail. Every
 * function of the Pipeline's run side panel has a home here; the side panel
 * stays for quick looks. Same role gate as the Laundry page.
 */
export default async function LaundryRunFullPage({ params }: { params: { id: string } }) {
  const session = await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
  const settings = await getAppSettings().catch(() => null);
  const timeZone = settings?.timezone || "Australia/Sydney";
  const todayKey = sydneyTodayKey();
  const impersonating = Boolean((session as { impersonation?: unknown }).impersonation);
  const [canChangeState, canVoidCapability] = await Promise.all([
    can(session, "laundry.change_state").catch(() => false),
    can(session, "laundry.void").catch(() => false),
  ]);
  const voidBlockedReason = !canVoidCapability
    ? "Voiding is for administrators."
    : impersonating
      ? "Voiding needs your own PIN, so it is not offered while testing as someone."
      : null;
  const isAdmin = session.user.role === Role.ADMIN;
  const loaded = await loadLaundryRunPage(params.id, {
    id: session.user.id, role: session.user.role, isAdmin, canChangeState, canVoid: canVoidCapability && !impersonating, voidBlockedReason, name: session.user.name ?? null,
  }, timeZone, todayKey);
  if (!loaded) notFound();
  // Dates become ISO strings, as the side panel receives them from the API.
  const task = JSON.parse(JSON.stringify(loaded.card)) as RunPanelTask & { voidedAt?: string | null };
  return (
    <LaundryRunPage
      task={task}
      extras={loaded.extras}
      viewer={{ canChangeState, canVoid: canVoidCapability && !impersonating, voidBlockedReason, isAdmin, todayKey, timeZone }}
      skipReasons={LAUNDRY_SKIP_REASONS.map((reason) => ({ value: reason.value, label: reason.label }))}
    />
  );
}
