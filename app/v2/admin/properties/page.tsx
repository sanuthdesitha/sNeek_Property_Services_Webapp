import { db } from "@/lib/db";
import { requireRole } from "@/lib/auth/session";
import { Role } from "@prisma/client";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Plus, Bed, Bath, RefreshCw, Building2 } from "lucide-react";
import { PropertiesMap, type PropertyMarker } from "@/components/admin/properties-map";
import { EButton, EPageHeader } from "@/components/v2/ui/primitives";

export const metadata = { title: "Properties · Estate admin" };
export const dynamic = "force-dynamic";

export default async function EstatePropertiesPage() {
  await requireRole([Role.ADMIN, Role.OPS_MANAGER]);

  const properties = await db.property.findMany({
    where: { isActive: true },
    include: {
      client: { select: { name: true } },
      integration: { select: { isEnabled: true, icalUrl: true, syncStatus: true, lastSyncAt: true } },
      _count: { select: { jobs: true, reservations: true } },
    },
    orderBy: [{ client: { name: "asc" } }, { name: "asc" }],
  });

  // Compute last-clean date per property in one query.
  const lastJobs = await db.job.groupBy({
    by: ["propertyId"],
    _max: { scheduledDate: true },
    where: { propertyId: { in: properties.map((p) => p.id) } },
  });
  const lastJobMap = new Map(lastJobs.map((j) => [j.propertyId, j._max.scheduledDate]));

  const markers: PropertyMarker[] = properties
    .filter((p) => p.latitude !== null && p.longitude !== null)
    .map((p) => ({
      id: p.id,
      name: p.name,
      address: `${p.address}, ${p.suburb}`,
      clientName: p.client.name,
      lat: p.latitude as number,
      lng: p.longitude as number,
      lastJobAt: lastJobMap.get(p.id)?.toISOString() ?? null,
    }));

  const syncStatusColor: Record<string, string> = {
    SUCCESS: "success",
    ERROR: "destructive",
    SYNCING: "default",
    IDLE: "secondary",
  };

  return (
    <div className="space-y-6">
      <EPageHeader
        eyebrow="Portfolio"
        title="Properties"
        description={`${properties.length} active properties`}
        actions={
          <EButton asChild variant="gold" size="sm"><Link href="/admin/properties/new">
              <Plus className="mr-1 h-3.5 w-3.5" /> Add Property
            </Link></EButton>
        }
      />

      <Tabs defaultValue="list">
        <TabsList>
          <TabsTrigger value="list">List</TabsTrigger>
          <TabsTrigger value="map">Map ({markers.length})</TabsTrigger>
        </TabsList>

        <TabsContent value="list" className="mt-4">
          {properties.length === 0 ? (
            <Card>
              <CardContent>
                <p className="p-10 text-center text-sm text-muted-foreground">
                  No properties. Add your first property from a client page.
                </p>
              </CardContent>
            </Card>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {properties.map((prop) => (
                <Link
                  key={prop.id}
                  href={`/admin/properties/${prop.id}`}
                  className="group flex flex-col overflow-hidden rounded-2xl border bg-card shadow-sm transition hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-md"
                >
                  {/* Cover photo (or branded fallback) */}
                  <div className="relative aspect-[16/10] w-full overflow-hidden bg-muted">
                    {prop.imageUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={prop.imageUrl}
                        alt={prop.name}
                        className="h-full w-full object-cover transition duration-300 group-hover:scale-[1.04]"
                      />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-primary/15 to-primary/5">
                        <Building2 className="h-10 w-10 text-primary/40" />
                      </div>
                    )}
                    {prop.integration?.isEnabled && prop.integration.icalUrl ? (
                      <Badge
                        variant={syncStatusColor[prop.integration.syncStatus] as any}
                        className="absolute left-2 top-2 gap-1 text-[10px] shadow-sm"
                      >
                        <RefreshCw className="h-2.5 w-2.5" />
                        iCal
                      </Badge>
                    ) : null}
                  </div>

                  <div className="flex flex-1 flex-col p-4">
                    <div className="flex items-start justify-between gap-2">
                      <h3 className="truncate font-semibold text-foreground">{prop.name}</h3>
                      <Badge variant="success" className="shrink-0 text-[11px]">Active</Badge>
                    </div>
                    <p className="mt-0.5 truncate text-sm text-muted-foreground">
                      {prop.suburb}
                      <span className="mx-1.5 text-muted-foreground/50">·</span>
                      <span className="inline-flex items-center gap-1">
                        <Bed className="h-3 w-3" /> {prop.bedrooms}
                      </span>
                      <span className="ml-2 inline-flex items-center gap-1">
                        <Bath className="h-3 w-3" /> {prop.bathrooms}
                      </span>
                    </p>

                    <div className="my-3 border-t" />

                    <div className="mt-auto flex items-center justify-between gap-2 text-sm">
                      <span className="truncate text-muted-foreground">
                        Client <span className="font-medium text-foreground">{prop.client.name}</span>
                      </span>
                      <span className="shrink-0 text-muted-foreground">
                        Jobs <span className="font-semibold text-foreground">{prop._count.jobs}</span>
                      </span>
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="map" className="mt-4">
          <PropertiesMap properties={markers} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
