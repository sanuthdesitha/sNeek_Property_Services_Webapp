import { redirect } from "next/navigation";
import { requireRole } from "@/lib/auth/session";
import { settingsHref } from "@/components/v2/admin/settings/settings-catalog";

export const dynamic = "force-dynamic";

export default async function HolidayRatesPage({
  searchParams,
}: {
  searchParams?: { jobId?: string };
}) {
  await requireRole(["ADMIN"]);
  redirect(settingsHref("holiday-rates", searchParams?.jobId));
}
