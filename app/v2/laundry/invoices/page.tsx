import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { InvoicesPanel } from "@/components/v2/laundry/invoices-panel";
import { EPageHeader } from "@/components/v2/ui/primitives";

export const metadata = { title: "Invoices · Estate laundry" };
export const dynamic = "force-dynamic";

// Mirrors app/laundry/invoices: same property query + endpoints, Estate-native.
export default async function LaundryInvoicesRoutePage() {
  await requireRole([Role.LAUNDRY, Role.ADMIN, Role.OPS_MANAGER]);

  const properties = await db.property
    .findMany({
      where: { laundryTasks: { some: {} }, isActive: true },
      select: { id: true, name: true, suburb: true },
      orderBy: [{ name: "asc" }],
      take: 1000,
    })
    .catch(() => [] as Array<{ id: string; name: string; suburb: string }>);

  return (
    <div className="space-y-6">
      <EPageHeader
        eyebrow="Billing"
        title="Invoices"
        description="Generate and review laundry invoices by property."
      />
      <InvoicesPanel properties={properties} />
    </div>
  );
}
