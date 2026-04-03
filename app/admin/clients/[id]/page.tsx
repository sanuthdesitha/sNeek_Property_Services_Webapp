import { db } from "@/lib/db";
import { requireRole } from "@/lib/auth/session";
import { Role } from "@prisma/client";
import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ClientDetailWorkspace } from "@/components/admin/client-detail-workspace";
import { ProfileActivityLog } from "@/components/admin/profile-activity-log";

export default async function ClientDetailPage({ params }: { params: { id: string } }) {
  await requireRole([Role.ADMIN, Role.OPS_MANAGER]);

  const client = await db.client.findUnique({
    where: { id: params.id },
    include: {
      leads: {
        select: {
          id: true,
          serviceType: true,
          estimateMin: true,
          estimateMax: true,
          status: true,
          createdAt: true,
        },
        orderBy: { createdAt: "desc" },
      },
      quotes: {
        select: {
          id: true,
          status: true,
          totalAmount: true,
          createdAt: true,
          validUntil: true,
        },
        orderBy: { createdAt: "desc" },
      },
      cases: {
        select: {
          id: true,
          title: true,
          status: true,
          caseType: true,
          createdAt: true,
        },
        orderBy: { createdAt: "desc" },
      },
      properties: {
        include: {
          integration: {
            select: {
              isEnabled: true,
              icalUrl: true,
              syncStatus: true,
            },
          },
          jobs: {
            select: {
              id: true,
              jobNumber: true,
              jobType: true,
              status: true,
              scheduledDate: true,
              property: { select: { id: true, name: true, suburb: true } },
            },
            orderBy: { scheduledDate: "desc" },
            take: 100,
          },
        },
        where: { isActive: true },
        orderBy: { name: "asc" },
      },
    },
  });

  if (!client) notFound();

  const jobs = client.properties.flatMap((property) => property.jobs);

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" asChild>
          <Link href="/admin/clients">
            <ArrowLeft className="h-4 w-4" />
          </Link>
        </Button>
        <div>
          <h1 className="text-2xl font-bold">Client Detail</h1>
          <p className="text-sm text-muted-foreground">Review contact info, leads, quotes, jobs, cases, and properties in one place.</p>
        </div>
      </div>

      <ClientDetailWorkspace
        client={{
          id: client.id,
          name: client.name,
          email: client.email,
          phone: client.phone,
          address: client.address,
          notes: client.notes,
          createdAt: client.createdAt,
          leads: client.leads,
          quotes: client.quotes,
          cases: client.cases,
          properties: client.properties.map((property) => ({
            id: property.id,
            name: property.name,
            address: property.address,
            suburb: property.suburb,
            bedrooms: property.bedrooms,
            bathrooms: property.bathrooms,
            integration: property.integration,
          })),
          jobs,
        }}
      />

      <ProfileActivityLog endpoint={`/api/admin/clients/${client.id}/activity`} title="Client Activity" />
    </div>
  );
}
