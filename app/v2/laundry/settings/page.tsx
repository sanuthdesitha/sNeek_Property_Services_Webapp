import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { EPageHeader } from "@/components/v2/ui/primitives";
import { EstateSettings } from "@/components/v2/laundry/estate-settings";

export const metadata = { title: "Settings · Estate laundry" };
export const dynamic = "force-dynamic";

// Estate-native settings (notifications + appearance) — no live-component imports.
export default async function LaundrySettingsPage() {
  await requireRole([Role.LAUNDRY, Role.ADMIN, Role.OPS_MANAGER]);

  return (
    <div className="space-y-6">
      <EPageHeader
        eyebrow="Preferences"
        title="Settings"
        description="Notifications and appearance."
      />
      <EstateSettings />
    </div>
  );
}
