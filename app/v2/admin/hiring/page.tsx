import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { ensureDefaultHiringPosition } from "@/lib/workforce/service";
import { ensureDefaultQuizTemplates } from "@/lib/workforce/quiz";
import { loadHiringHub } from "@/lib/hiring/hub-data";
import { getAppSettings } from "@/lib/settings";
import { resolveAppUrl } from "@/lib/app-url";
import { HiringPipeline } from "@/components/v2/admin/hiring/pipeline/hiring-pipeline";

export const metadata = { title: "Hiring · Estate admin" };
export const dynamic = "force-dynamic";

/** Hiring hub (boards "Hiring" and "Hiring on a phone", 2026-11-16). Cards are worded on the server in the organisation timezone. */
export default async function V2HiringPage() {
  const session = await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
  await ensureDefaultHiringPosition(session.user.id);
  await ensureDefaultQuizTemplates();
  const settings = await getAppSettings();
  const hub = await loadHiringHub(settings.timezone || "Australia/Sydney");
  return <HiringPipeline {...hub} careersUrl={resolveAppUrl("/v2/careers")} />;
}
