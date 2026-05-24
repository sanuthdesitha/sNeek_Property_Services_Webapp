import { db } from "@/lib/db";
import { requireRole } from "@/lib/auth/session";
import { JobStatus, Role } from "@prisma/client";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Plus, Building2, Mail, Phone } from "lucide-react";
import { ClientsCardsGrid, type ClientCardStats } from "@/components/admin/clients-cards-grid";

const ACTIVE_JOB_STATUSES: JobStatus[] = [
  JobStatus.UNASSIGNED,
  JobStatus.OFFERED,
  JobStatus.ASSIGNED,
  JobStatus.EN_ROUTE,
  JobStatus.IN_PROGRESS,
  JobStatus.PAUSED,
  JobStatus.WAITING_CONTINUATION_APPROVAL,
  JobStatus.SUBMITTED,
  JobStatus.QA_REVIEW,
];

export default async function ClientsPage() {
  await requireRole([Role.ADMIN, Role.OPS_MANAGER]);

  const clients = await db.client.findMany({
    where: { isActive: true },
    include: { _count: { select: { properties: true } } },
    orderBy: { name: "asc" },
  });

  const clientIds = clients.map((c) => c.id);

  // Batch: active jobs per client + last invoice per client.
  const [activeJobsAgg, latestInvoices] = await Promise.all([
    clientIds.length === 0
      ? Promise.resolve([] as Array<{ clientId: string; count: bigint }>)
      : db.$queryRaw<Array<{ clientId: string; count: bigint }>>`
          SELECT p."clientId" AS "clientId", COUNT(j.*)::bigint AS "count"
          FROM "Job" j
          JOIN "Property" p ON p.id = j."propertyId"
          WHERE p."clientId" = ANY(${clientIds}::text[])
            AND j.status::text = ANY(${ACTIVE_JOB_STATUSES.map((s) => s.toString())}::text[])
          GROUP BY p."clientId"
        `,
    clientIds.length === 0
      ? Promise.resolve([] as Array<{ clientId: string; totalAmount: number; createdAt: Date }>)
      : db.$queryRaw<Array<{ clientId: string; totalAmount: number; createdAt: Date }>>`
          SELECT DISTINCT ON ("clientId") "clientId", "totalAmount", "createdAt"
          FROM "ClientInvoice"
          WHERE "clientId" = ANY(${clientIds}::text[])
          ORDER BY "clientId", "createdAt" DESC
        `,
  ]);

  const activeJobMap = new Map(activeJobsAgg.map((r) => [r.clientId, Number(r.count)]));
  const invoiceMap = new Map(latestInvoices.map((r) => [r.clientId, r]));

  const cardStats: ClientCardStats[] = clients.map((c) => {
    const inv = invoiceMap.get(c.id);
    return {
      id: c.id,
      name: c.name,
      email: c.email,
      phone: c.phone,
      propertiesCount: c._count.properties,
      activeJobsCount: activeJobMap.get(c.id) ?? 0,
      lastInvoiceAmount: inv?.totalAmount ?? null,
      lastInvoiceAt: inv?.createdAt?.toISOString() ?? null,
    };
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-foreground">Clients</h2>
          <p className="text-sm text-muted-foreground">{clients.length} active clients</p>
        </div>
        <Button asChild>
          <Link href="/admin/clients/new">
            <Plus className="h-4 w-4 mr-2" />
            Add Client
          </Link>
        </Button>
      </div>

      <Tabs defaultValue="cards">
        <TabsList>
          <TabsTrigger value="cards">Cards</TabsTrigger>
          <TabsTrigger value="table">Table</TabsTrigger>
        </TabsList>

        <TabsContent value="cards" className="mt-4">
          <ClientsCardsGrid clients={cardStats} />
        </TabsContent>

        <TabsContent value="table" className="mt-4">
          <Card>
            <CardContent className="p-0">
              <div className="divide-y">
                {clients.map((client) => (
                  <Link
                    key={client.id}
                    href={`/admin/clients/${client.id}`}
                    className="flex items-center justify-between px-6 py-3 hover:bg-muted/50 transition-colors"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <Badge variant="outline" className="shrink-0">
                        <Building2 className="h-3 w-3 mr-1" />
                        {client._count.properties}
                      </Badge>
                      <span className="font-medium truncate">{client.name}</span>
                    </div>
                    <div className="hidden sm:flex items-center gap-4 text-xs text-muted-foreground">
                      {client.email && (
                        <span className="flex items-center gap-1">
                          <Mail className="h-3 w-3" /> {client.email}
                        </span>
                      )}
                      {client.phone && (
                        <span className="flex items-center gap-1">
                          <Phone className="h-3 w-3" /> {client.phone}
                        </span>
                      )}
                    </div>
                  </Link>
                ))}
                {clients.length === 0 && (
                  <p className="p-10 text-center text-sm text-muted-foreground">
                    No clients yet.
                  </p>
                )}
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
