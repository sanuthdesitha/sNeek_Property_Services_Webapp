import { db } from "@/lib/db";
import { requireRole } from "@/lib/auth/session";
import { Role } from "@prisma/client";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Plus, Building2, Mail, Phone } from "lucide-react";

export default async function ClientsPage() {
  await requireRole([Role.ADMIN, Role.OPS_MANAGER]);

  const clients = await db.client.findMany({
    where: { isActive: true },
    include: { _count: { select: { properties: true } } },
    orderBy: { name: "asc" },
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold">Clients</h2>
          <p className="text-sm text-muted-foreground">{clients.length} active clients</p>
        </div>
        <Button asChild>
          <Link href="/admin/clients/new">
            <Plus className="h-4 w-4 mr-2" />
            Add Client
          </Link>
        </Button>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {clients.map((client) => (
          <Link key={client.id} href={`/admin/clients/${client.id}`}>
            <Card className="hover:border-primary/50 transition-colors cursor-pointer h-full">
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center justify-between">
                  <span className="truncate">{client.name}</span>
                  <Badge variant="outline" className="ml-2 shrink-0">
                    <Building2 className="h-3 w-3 mr-1" />
                    {client._count.properties}
                  </Badge>
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-1">
                {client.email && (
                  <p className="text-sm text-muted-foreground flex items-center gap-2">
                    <Mail className="h-3 w-3" /> {client.email}
                  </p>
                )}
                {client.phone && (
                  <p className="text-sm text-muted-foreground flex items-center gap-2">
                    <Phone className="h-3 w-3" /> {client.phone}
                  </p>
                )}
                {!client.email && !client.phone && (
                  <p className="text-sm text-muted-foreground italic">No contact info</p>
                )}
              </CardContent>
            </Card>
          </Link>
        ))}

        {clients.length === 0 && (
          <div className="col-span-full text-center py-16 text-muted-foreground">
            No clients yet.{" "}
            <Link href="/admin/clients/new" className="text-primary hover:underline">
              Add your first client →
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}
