import Link from "next/link";
import { Building2, ClipboardList, Package, Shirt } from "lucide-react";
import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { ensureClientModuleAccess } from "@/lib/portal-access";
import { listClientPropertiesForUser } from "@/lib/client/portal-data";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

export default async function ClientPropertiesPage() {
  await ensureClientModuleAccess("properties");
  const session = await requireRole([Role.CLIENT]);
  const properties = await listClientPropertiesForUser(session.user.id);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Properties</h1>
          <p className="text-sm text-muted-foreground">
            View each property separately with its checklist, inventory, jobs, laundry, and reports.
          </p>
        </div>
        <Button asChild variant="outline">
          <Link href="/client">Back</Link>
        </Button>
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {properties.map((property) => (
          <Link key={property.id} href={`/client/properties/${property.id}`}>
            <Card className="h-full transition hover:border-primary/40">
              <CardHeader className="pb-3">
                <CardTitle className="flex items-start gap-3 text-base">
                  <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-primary/10">
                    <Building2 className="h-5 w-5 text-primary" />
                  </span>
                  <span className="space-y-1">
                    <span className="block">{property.name}</span>
                    <span className="block text-xs font-normal text-muted-foreground">
                      {property.address}, {property.suburb}
                    </span>
                  </span>
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                <div className="flex items-center gap-2 text-muted-foreground">
                  <ClipboardList className="h-4 w-4" />
                  <span>{property._count.jobs} jobs recorded</span>
                </div>
                <div className="flex items-center gap-2 text-muted-foreground">
                  <Package className="h-4 w-4" />
                  <span>{property.inventoryEnabled ? "Inventory tracked" : "Inventory hidden"}</span>
                </div>
                <div className="flex items-center gap-2 text-muted-foreground">
                  <Shirt className="h-4 w-4" />
                  <span>{property.bedrooms}bd / {property.bathrooms}ba</span>
                </div>
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}
