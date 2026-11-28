import Link from "next/link";
import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { getAppSettings } from "@/lib/settings";
import { EButton, EPageHeader } from "@/components/v2/ui/primitives";
import { ReminderRulesWorkspace } from "@/components/v2/admin/settings/reminder-rules-workspace";

export const metadata = { title: "Property reminder rules · Estate admin" };
export const dynamic = "force-dynamic";

/**
 * Settings › Cleaners & quality › Property reminder rules (2026-11-28).
 * Reminder suggestions (approve / edit then approve / dismiss: ADMIN, and
 * OPS_MANAGER with the Properties pack at manage) above the automatic rules
 * (administrators switch them after a live preview; operations managers with
 * the Settings pack view). Each API re-checks.
 */
export default async function ReminderRulesPage() {
  await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
  const settings = await getAppSettings().catch(() => null);
  return (
    <div className="min-w-0 space-y-5">
      <EPageHeader
        eyebrow="Settings › Cleaners & quality"
        title="Property reminder rules"
        description="Reminders for cleaners made from records the app already keeps: suggestions to approve one by one, and automatic rules that are off until an administrator checks their preview. Every reminder says which facts made it."
        actions={<EButton asChild variant="outline" size="sm"><Link href="/v2/admin/settings">Back to settings</Link></EButton>}
      />
      <ReminderRulesWorkspace timeZone={settings?.timezone ?? "Australia/Sydney"} />
    </div>
  );
}
