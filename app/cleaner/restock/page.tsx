import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { CleanerRestockClient } from "@/components/cleaner/restock-client";

export const dynamic = "force-dynamic";

export default async function CleanerRestockPage() {
  await requireRole([Role.CLEANER, Role.ADMIN, Role.OPS_MANAGER]);
  return <CleanerRestockClient />;
}
