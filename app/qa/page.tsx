import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { QaQueueClient } from "@/components/qa/qa-queue-client";

export default async function QaQueuePage() {
  await requireRole([Role.QA_INSPECTOR, Role.OPS_MANAGER, Role.ADMIN]);
  const inspectors = await db.user.findMany({
    where: { role: { in: [Role.QA_INSPECTOR, Role.OPS_MANAGER] }, isActive: true },
    select: { id: true, name: true, email: true, role: true },
    orderBy: [{ role: "asc" }, { name: "asc" }, { email: "asc" }],
  });
  return <QaQueueClient inspectors={inspectors} />;
}
