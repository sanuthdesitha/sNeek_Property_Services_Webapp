import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { getAppSettings } from "@/lib/settings";
import { LostFoundHub } from "@/components/v2/admin/lost-found/lost-found-hub";
import { readLostFoundView } from "@/components/v2/admin/lost-found/lost-found-view";

export const metadata = { title: "Lost and found · Estate admin" };
export const dynamic = "force-dynamic";

/**
 * Lost and found: every found item in one table with stage tabs, filters,
 * paging, bulk actions and an item panel on `?open=`. Guest details come from
 * the job's departing booking. Admin / ops only, as before; the office can
 * now log an item itself.
 */
export default async function V2AdminLostFoundPage({ searchParams }: { searchParams?: Record<string, string | string[] | undefined> }) {
  const session = await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(searchParams ?? {})) {
    const first = Array.isArray(value) ? value[0] : value;
    if (typeof first === "string") query.set(key, first);
  }
  const settings = await getAppSettings();
  return (
    <LostFoundHub
      initialView={readLostFoundView(`?${query.toString()}`)}
      isAdmin={session.user.role === Role.ADMIN}
      timeZone={settings.timezone || "Australia/Sydney"}
    />
  );
}
