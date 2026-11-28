import Link from "next/link";
import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { getAppSettings } from "@/lib/settings";
import { EButton, EPageHeader } from "@/components/v2/ui/primitives";
import { PilotFeatures } from "@/components/v2/admin/settings/pilot-features";

export const metadata = { title: "Pilot features · Estate admin" };
export const dynamic = "force-dynamic";

/**
 * Settings › System › Pilot features (2026-11-28). Administrators switch
 * pilots Off / On for everyone / On for selected people or properties;
 * operations managers with the Settings pack view. The API re-checks.
 */
export default async function PilotFeaturesPage() {
  await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
  const [settings, people, properties] = await Promise.all([
    getAppSettings().catch(() => null),
    db.user.findMany({ where: { isActive: true, role: { in: [Role.CLEANER, Role.OPS_MANAGER, Role.ADMIN, Role.QA_INSPECTOR] } }, select: { id: true, name: true, email: true, role: true }, orderBy: [{ name: "asc" }, { email: "asc" }], take: 500 }),
    db.property.findMany({ where: { isActive: true }, select: { id: true, name: true, suburb: true }, orderBy: { name: "asc" }, take: 1000 }),
  ]);
  return (
    <div className="min-w-0 space-y-5">
      <EPageHeader
        eyebrow="Settings › System"
        title="Pilot features"
        description="New behaviours start here as pilots: off, on for everyone, or on for a few people or properties first. Turning one off goes straight back to the previous behaviour; nothing already entered is lost."
        actions={<EButton asChild variant="outline" size="sm"><Link href="/v2/admin/settings?tab=audit">Back to settings</Link></EButton>}
      />
      <PilotFeatures
        timezone={settings?.timezone ?? "Australia/Sydney"}
        people={people.map((person) => ({ id: person.id, name: `${person.name || person.email} · ${person.role === Role.CLEANER ? "cleaner" : person.role.toLowerCase().replace("_", " ")}` }))}
        properties={properties.map((property) => ({ id: property.id, name: property.suburb ? `${property.name} · ${property.suburb}` : property.name }))}
      />
    </div>
  );
}
