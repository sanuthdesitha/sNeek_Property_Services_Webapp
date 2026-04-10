import { db } from "@/lib/db";
import { requireRole } from "@/lib/auth/session";
import { Role } from "@prisma/client";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Plus, Building2, Bed, Bath, RefreshCw } from "lucide-react";

export default async function PropertiesPage() {
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

  const syncStatusColor: Record<string, string> = {
    SUCCESS: "success",
    ERROR: "destructive",
    SYNCING: "default",
    IDLE: "secondary",
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold">Properties</h2>
          <p className="text-sm text-muted-foreground">{properties.length} active properties</p>
        </div>
        <Button asChild>
          <Link href="/admin/properties/new">
            <Plus className="h-4 w-4 mr-2" /> Add Property
          </Link>
        </Button>
      </div>

      <Card>
        <CardContent className="p-0">
          <div className="divide-y">
            {properties.map(prop => (
              <Link key={prop.id} href={`/admin/properties/${prop.id}`} className="flex items-center justify-between px-6 py-4 hover:bg-muted/50 transition-colors">
                <div className="flex items-center gap-4">
                  <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                    <Building2 className="h-5 w-5 text-primary" />
                  </div>
                  <div>
                    <p className="font-medium">{prop.name}</p>
                    <p className="text-sm text-muted-foreground">{prop.address}, {prop.suburb}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">{prop.client.name}</p>
                  </div>
                </div>
                <div className="flex items-center gap-4 text-sm text-muted-foreground">
                  <span className="hidden md:flex items-center gap-1">
                    <Bed className="h-3 w-3" /> {prop.bedrooms}
                    <Bath className="h-3 w-3 ml-1" /> {prop.bathrooms}
                  </span>
                  <span className="hidden sm:block">{prop._count.jobs} jobs</span>
                  {!prop.laundryEnabled && (
                    <Badge variant="secondary" className="text-xs">No laundry</Badge>
                  )}
                  {prop.integration?.isEnabled && prop.integration.icalUrl && (
                    <Badge variant={syncStatusColor[prop.integration.syncStatus] as any} className="text-xs gap-1">
                      <RefreshCw className="h-2.5 w-2.5" />
                      iCal {prop.integration.syncStatus}
                    </Badge>
                  )}
                </div>
              </Link>
            ))}
            {properties.length === 0 && (
              <p className="p-10 text-center text-sm text-muted-foreground">No properties. Add your first property from a client page.</p>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
