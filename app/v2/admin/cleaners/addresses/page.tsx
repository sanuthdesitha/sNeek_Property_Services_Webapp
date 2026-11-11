import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { EButton, ECard, EEmptyState, EPageHeader } from "@/components/v2/ui/primitives";
import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { holdsRoleWhere } from "@/lib/auth/role-query";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";
export const metadata = { title: "Cleaner addresses · Route planning" };

export default async function CleanerAddressesPage() {
  await requireRole([Role.ADMIN]);
  const cleaners = await db.user.findMany({
    where: { isActive: true, ...holdsRoleWhere(Role.CLEANER) },
    select: { id: true, name: true, address: true, suburb: true },
    orderBy: [{ suburb: "asc" }, { name: "asc" }, { id: "asc" }],
  });
  return (
    <div className="space-y-6">
      <EButton asChild variant="ghost" size="sm">
        <Link href="/v2/admin/cleaners">
          <ArrowLeft className="h-4 w-4" aria-hidden />
          Cleaners
        </Link>
      </EButton>
      <EPageHeader
        eyebrow="Workforce"
        title="Cleaner home addresses"
        description="Residential details already on file for active cleaners, for route planning."
      />
      {cleaners.length ? (
        <ECard className="overflow-x-auto">
          <table className="w-full min-w-[32rem] text-left text-[0.875rem]">
            <thead>
              <tr className="border-b border-[hsl(var(--e-border))] text-[0.6875rem] uppercase tracking-[0.14em] text-[hsl(var(--e-muted-foreground))]">
                <th className="px-4 py-3 font-semibold">Cleaner</th>
                <th className="px-4 py-3 font-semibold">Residential address</th>
                <th className="px-4 py-3 font-semibold">Suburb</th>
              </tr>
            </thead>
            <tbody>
              {cleaners.map((cleaner) => (
                <tr key={cleaner.id} className="border-b border-[hsl(var(--e-border))] last:border-0">
                  <th scope="row" className="px-4 py-3 font-medium">{cleaner.name}</th>
                  <td className="px-4 py-3">{cleaner.address || "Not recorded"}</td>
                  <td className="px-4 py-3">{cleaner.suburb || "Not recorded"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </ECard>
      ) : (
        <EEmptyState title="No active cleaners" description="Addresses appear here once a cleaner account is active." />
      )}
    </div>
  );
}
