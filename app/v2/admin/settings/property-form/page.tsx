import { Role } from "@prisma/client";
import { redirect } from "next/navigation";
import { requireRole } from "@/lib/auth/session";
import { settingsHref } from "@/components/v2/admin/settings/settings-catalog";

export const dynamic = "force-dynamic";

export default async function PropertyFormSettingsPage() {
  await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
  redirect(settingsHref("property-form"));
}
