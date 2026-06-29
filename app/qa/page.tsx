import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { QaQueueClient } from "@/components/qa/qa-queue-client";

export default async function QaQueuePage() {
  const session = await requireRole([Role.QA_INSPECTOR, Role.OPS_MANAGER, Role.ADMIN]);
  // Assigning inspections is an admin/ops responsibility — QA inspectors review
  // the jobs assigned to them, they don't hand work out. Only load the inspector
  // roster (and show assignment controls) for admin/ops viewers.
  const canAssign = session.user.role === Role.ADMIN || session.user.role === Role.OPS_MANAGER;
  const inspectors = canAssign
    ? await db.user.findMany({
        where: { role: { in: [Role.QA_INSPECTOR, Role.OPS_MANAGER] }, isActive: true },
        select: { id: true, name: true, email: true, role: true },
        orderBy: [{ role: "asc" }, { name: "asc" }, { email: "asc" }],
      })
    : [];
  return <QaQueueClient inspectors={inspectors} canAssign={canAssign} />;
}
