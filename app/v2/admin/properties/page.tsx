import Link from "next/link";
import { Role } from "@prisma/client";
import { db } from "@/lib/db";
import { requireRole } from "@/lib/auth/session";
import {
  EBadge,
  EButton,
  ECard,
  ECardBody,
  EEmptyState,
  EPageHeader,
  EStatCard,
} from "@/components/v2/ui/primitives";
import { Building2, Bed, Bath, MapPin, RefreshCw, ArrowUpRight } from "lucide-react";

export const metadata = { title: "Properties · Estate admin" };
export const dynamic = "force-dynamic";

async function getProperties() {
  return db.property
    .findMany({
      where: { isActive: true },
      include: {
        client: { select: { name: true } },
        integration: { select: { isEnabled: true, icalUrl: true } },
        _count: { select: { jobs: true } },
      },
      orderBy: [{ client: { name: "asc" } }, { name: "asc" }],
    })
    .catch(() => []);
}

export default async function EstatePropertiesPage() {
  await requireRole([Role.ADMIN, Role.OPS_MANAGER]);

  const properties = await getProperties();
  const withIcal = properties.filter((p) => p.integration?.isEnabled && p.integration.icalUrl).length;
  const totalJobs = properties.reduce((s, p) => s + p._count.jobs, 0);

  return (
    <div className="space-y-6">
      <EPageHeader
        eyebrow="Portfolio"
        title="Properties"
        description={`${properties.length} active ${properties.length === 1 ? "property" : "properties"} under management.`}
        actions={
          <EButton asChild variant="gold" size="sm"><Link href="/admin/properties">
              Full properties hub <ArrowUpRight className="h-3.5 w-3.5" />
            </Link></EButton>
        }
      />

      <section className="grid grid-cols-2 gap-4 lg:grid-cols-3">
        <EStatCard label="Active properties" value={properties.length} icon={<Building2 className="h-4 w-4" />} />
        <EStatCard label="iCal synced" value={withIcal} icon={<RefreshCw className="h-4 w-4" />} />
        <EStatCard label="Total jobs" value={totalJobs} icon={<MapPin className="h-4 w-4" />} />
      </section>

      {properties.length === 0 ? (
        <EEmptyState
          eyebrow="No properties yet"
          title="Your portfolio is empty"
          description="Add your first property from a client page in the full hub."
        />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {properties.map((prop) => (
            <Link key={prop.id} href={`/admin/properties/${prop.id}`} className="group block">
              <ECard className="flex h-full flex-col overflow-hidden transition hover:-translate-y-0.5 hover:border-[hsl(var(--e-border-gold)/0.5)] hover:shadow-[var(--e-elevation-gold)]">
                <div className="relative aspect-[16/10] w-full overflow-hidden bg-[hsl(var(--e-muted))]">
                  {prop.imageUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={prop.imageUrl}
                      alt={prop.name}
                      className="h-full w-full object-cover transition duration-300 group-hover:scale-[1.04]"
                    />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center">
                      <Building2 className="h-10 w-10 text-[hsl(var(--e-accent-portal)/0.4)]" />
                    </div>
                  )}
                  {prop.integration?.isEnabled && prop.integration.icalUrl ? (
                    <span className="absolute left-2 top-2">
                      <EBadge tone="info" soft>
                        <RefreshCw className="h-2.5 w-2.5" /> iCal
                      </EBadge>
                    </span>
                  ) : null}
                </div>

                <ECardBody className="flex flex-1 flex-col pt-4">
                  <div className="flex items-start justify-between gap-2">
                    <h3 className="truncate font-[550] text-[hsl(var(--e-foreground))]">{prop.name}</h3>
                    <EBadge tone="primary" soft>
                      Active
                    </EBadge>
                  </div>
                  <p className="mt-0.5 flex items-center gap-1.5 truncate text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">
                    <span className="truncate">{prop.suburb}</span>
                    <span className="text-[hsl(var(--e-text-faint))]">·</span>
                    <span className="inline-flex items-center gap-1">
                      <Bed className="h-3 w-3" /> {prop.bedrooms}
                    </span>
                    <span className="inline-flex items-center gap-1">
                      <Bath className="h-3 w-3" /> {prop.bathrooms}
                    </span>
                  </p>

                  <div className="my-3 border-t border-[hsl(var(--e-border)/0.7)]" />

                  <div className="mt-auto flex items-center justify-between gap-2 text-[0.8125rem]">
                    <span className="truncate text-[hsl(var(--e-muted-foreground))]">
                      Client{" "}
                      <span className="font-[550] text-[hsl(var(--e-foreground))]">{prop.client.name}</span>
                    </span>
                    <span className="shrink-0 text-[hsl(var(--e-muted-foreground))]">
                      Jobs{" "}
                      <span className="e-numeral text-[hsl(var(--e-foreground))]">{prop._count.jobs}</span>
                    </span>
                  </div>
                </ECardBody>
              </ECard>
            </Link>
          ))}
        </div>
      )}

      <p className="text-[0.75rem] text-[hsl(var(--e-text-faint))]">
        Estate preview · live data from your workspace. Add properties, view the map and manage iCal in the{" "}
        <Link href="/admin/properties" className="underline">
          full properties hub
        </Link>
        .
      </p>
    </div>
  );
}
