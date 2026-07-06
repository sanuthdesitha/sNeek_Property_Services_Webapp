import Link from "next/link";
import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { listClientPropertiesForUser } from "@/lib/client/portal-data";
import {
  EBadge,
  ECard,
  ECardBody,
  EEmptyState,
  EPageHeader,
} from "@/components/v2/ui/primitives";
import { Building2, ClipboardList, Package } from "lucide-react";

export const metadata = { title: "Properties · Estate client" };
export const dynamic = "force-dynamic";

export default async function ClientPropertiesPage() {
  const session = await requireRole([Role.CLIENT]);
  const properties = await listClientPropertiesForUser(session.user.id).catch(() => []);

  return (
    <div className="space-y-6">
      <EPageHeader
        eyebrow="Your homes"
        title="Properties"
        description="Inventory, supplies, and service history live inside each property."
      />

      {properties.length === 0 ? (
        <EEmptyState
          eyebrow="Nothing yet"
          title="No properties on file"
          description="Properties linked to your account will appear here."
        />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {properties.map((p) => (
            <Link key={p.id} href={`/v2/client/properties/${p.id}`} className="group block">
              <ECard className="h-full transition-colors duration-[160ms] group-hover:border-[hsl(var(--e-gold))]">
              <ECardBody className="space-y-3 pt-6">
                <div className="flex items-start justify-between">
                  <span className="flex h-10 w-10 items-center justify-center rounded-[var(--e-radius)] border border-[hsl(var(--e-border-strong))] text-[hsl(var(--e-accent-portal))]">
                    <Building2 className="h-5 w-5" />
                  </span>
                  <EBadge tone={p.inventoryEnabled ? "primary" : "neutral"} soft>
                    {p.inventoryEnabled ? "Inventory tracked" : "Active"}
                  </EBadge>
                </div>
                <div>
                  <p className="text-[1rem] font-[550]">{p.name}</p>
                  <p className="text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">
                    {[p.address, p.suburb].filter(Boolean).join(", ")}
                  </p>
                </div>
                <div className="e-signature-rule" />
                <div className="grid grid-cols-2 gap-3 text-[0.8125rem] text-[hsl(var(--e-text-secondary))]">
                  <span className="flex items-center gap-2">
                    <ClipboardList className="h-4 w-4 text-[hsl(var(--e-text-faint))]" />
                    {p._count.jobs} job{p._count.jobs === 1 ? "" : "s"}
                  </span>
                  <span className="flex items-center gap-2">
                    <Package className="h-4 w-4 text-[hsl(var(--e-text-faint))]" />
                    {p.bedrooms}bd · {p.bathrooms}ba
                  </span>
                </div>
              </ECardBody>
              </ECard>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
