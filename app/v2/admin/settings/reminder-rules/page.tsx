import Link from "next/link";
import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { getAppSettings } from "@/lib/settings";
import { EButton, EPageHeader } from "@/components/v2/ui/primitives";
import { ReminderRules } from "@/components/v2/admin/settings/reminder-rules";

export const metadata = { title: "Property reminder rules · Estate admin" };
export const dynamic = "force-dynamic";

/**
 * Settings › Cleaners & quality › Property reminder rules (2026-11-28).
 * Administrators switch automatic reminder rules after a live preview;
 * operations managers with the Settings pack view. The API re-checks.
 */
export default async function ReminderRulesPage() {
  await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
  const settings = await getAppSettings().catch(() => null);
  return (
    <div className="min-w-0 space-y-5">
      <EPageHeader
        eyebrow="Settings › Cleaners & quality"
        title="Property reminder rules"
        description="Automatic reminders for cleaners, made from records the app already keeps. Every rule is off until an administrator checks its preview; every reminder says which facts made it."
        actions={<EButton asChild variant="outline" size="sm"><Link href="/v2/admin/settings">Back to settings</Link></EButton>}
      />
      <ReminderRules timeZone={settings?.timezone ?? "Australia/Sydney"} />
    </div>
  );
}
