import { redirect } from "next/navigation";
import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { sydneyTodayKey } from "@/lib/time/sydney-range";
import { opsMapRedirectTarget } from "@/lib/ops/ops-map-redirect";

export const dynamic = "force-dynamic";

/** The old live map: redirects to Live ops (or the route map for another day). */
export default async function V2OpsMapRedirect({ searchParams = {} }: { searchParams?: Record<string, string | string[] | undefined> }) {
  await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
  redirect(opsMapRedirectTarget(searchParams, sydneyTodayKey()));
}
