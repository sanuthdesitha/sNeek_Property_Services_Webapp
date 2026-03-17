import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { ensureLaundryModuleAccess } from "@/lib/portal-access";
import { Role } from "@prisma/client";
import { LaundryInvoicesPage } from "@/components/laundry/invoices-page";

export default async function LaundryInvoicesRoutePage() {
  await ensureLaundryModuleAccess("invoices");
  await requireRole([Role.LAUNDRY, Role.ADMIN, Role.OPS_MANAGER]);

  const properties = await db.property.findMany({
    where: {
      laundryTasks: { some: {} },
      isActive: true,
    },
    select: { id: true, name: true, suburb: true },
    orderBy: [{ name: "asc" }],
    take: 1000,
  });

  return <LaundryInvoicesPage properties={properties} />;
}
