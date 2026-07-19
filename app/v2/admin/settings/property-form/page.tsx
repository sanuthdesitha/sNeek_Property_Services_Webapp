import { Role } from "@prisma/client";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { requireRole } from "@/lib/auth/session";
import { EButton, EPageHeader } from "@/components/v2/ui/primitives";
import { getPropertyFormConfig } from "@/lib/property-form/config-store";
import { PropertyFormEditor } from "@/components/v2/admin/settings/property-form-editor";

export const metadata = { title: "Property form · Estate admin" };
export const dynamic = "force-dynamic";

export default async function PropertyFormSettingsPage() {
  await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
  const config = await getPropertyFormConfig();

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        <EButton asChild variant="ghost" size="icon">
          <Link href="/v2/admin/properties" aria-label="Back to properties">
            <ArrowLeft className="h-4 w-4" />
          </Link>
        </EButton>
        <span className="text-[0.75rem] text-[hsl(var(--e-text-faint))]">Properties</span>
      </div>

      <EPageHeader
        eyebrow="Settings"
        title="Property form fields"
        description="Configure the add-property form — required fields, conditional visibility, and custom fields."
      />

      <PropertyFormEditor initialConfig={config} />
    </div>
  );
}
