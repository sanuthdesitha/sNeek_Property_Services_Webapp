import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { getAppSettings } from "@/lib/settings";
import { PortfolioHub } from "@/components/v2/admin/properties/list/portfolio-hub";
import { readPortfolioView } from "@/components/v2/admin/properties/list/portfolio-view";

export const metadata = { title: "Properties · Estate admin" };
export const dynamic = "force-dynamic";

/**
 * Properties: the active portfolio as a sortable, server-paged table (with
 * Cards and Map views), attention chips, bulk actions and a preview panel on
 * `?open=`. ADMIN / OPS_MANAGER as before. `?includeOneOff=1` still shows the
 * one-off service sites.
 */
export default async function EstatePropertiesPage({ searchParams }: { searchParams?: Record<string, string | string[] | undefined> }) {
  await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(searchParams ?? {})) {
    const first = Array.isArray(value) ? value[0] : value;
    if (typeof first === "string") query.set(key, first);
  }
  const settings = await getAppSettings();
  return <PortfolioHub initialView={readPortfolioView(`?${query.toString()}`)} timeZone={settings.timezone || "Australia/Sydney"} />;
}
