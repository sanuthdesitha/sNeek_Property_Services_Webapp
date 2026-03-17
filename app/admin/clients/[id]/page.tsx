import { db } from "@/lib/db";
import { requireRole } from "@/lib/auth/session";
import { Role } from "@prisma/client";
import { notFound } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ArrowLeft, Building2, Edit, Plus } from "lucide-react";
import { format } from "date-fns";

export default async function ClientDetailPage({ params }: { params: { id: string } }) {
  await requireRole([Role.ADMIN, Role.OPS_MANAGER]);

  const client = await db.client.findUnique({
    where: { id: params.id },
    include: {
      properties: {
        where: { isActive: true },
        include: { integration: true, _count: { select: { jobs: true } } },
        orderBy: { name: "asc" },
      },
    },
  });

  if (!client) notFound();

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" asChild>
          <Link href="/admin/clients"><ArrowLeft className="h-4 w-4" /></Link>
        </Button>
        <div className="flex-1">
          <h2 className="text-2xl font-bold">{client.name}</h2>
          <p className="text-sm text-muted-foreground">
            Client since {format(client.createdAt, "MMMM yyyy")}
          </p>
        </div>
        <Button variant="outline" size="sm" asChild>
          <Link href={`/admin/clients/${client.id}/edit`}>
            <Edit className="h-4 w-4 mr-2" /> Edit
          </Link>
        </Button>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Info card */}
        <Card>
          <CardHeader><CardTitle className="text-sm">Contact Info</CardTitle></CardHeader>
          <CardContent className="space-y-2 text-sm">
            {client.email && <div><span className="text-muted-foreground">Email: </span>{client.email}</div>}
            {client.phone && <div><span className="text-muted-foreground">Phone: </span>{client.phone}</div>}
            {client.address && <div><span className="text-muted-foreground">Address: </span>{client.address}</div>}
            {client.notes && (
              <div className="pt-2 border-t">
                <p className="text-muted-foreground text-xs mb-1">Notes</p>
                <p className="text-sm">{client.notes}</p>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Properties */}
        <div className="lg:col-span-2 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold">Properties ({client.properties.length})</h3>
            <Button size="sm" asChild>
              <Link href={`/admin/properties/new?clientId=${client.id}`}>
                <Plus className="h-4 w-4 mr-1" /> Add Property
              </Link>
            </Button>
          </div>

          <div className="space-y-3">
            {client.properties.map((prop) => (
              <Link key={prop.id} href={`/admin/properties/${prop.id}`}>
                <Card className="hover:border-primary/50 transition-colors cursor-pointer">
                  <CardContent className="flex items-center justify-between p-4">
                    <div>
                      <p className="font-medium">{prop.name}</p>
                      <p className="text-sm text-muted-foreground">
                        {prop.address}, {prop.suburb} · {prop.bedrooms}bd {prop.bathrooms}ba
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      {prop.integration?.isEnabled && prop.integration.icalUrl && (
                        <Badge variant="success" className="text-xs">iCal</Badge>
                      )}
                      <Badge variant="outline">
                        <Building2 className="h-3 w-3 mr-1" />
                        {prop._count.jobs} jobs
                      </Badge>
                    </div>
                  </CardContent>
                </Card>
              </Link>
            ))}

            {client.properties.length === 0 && (
              <p className="text-sm text-muted-foreground text-center py-8">No properties yet.</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
