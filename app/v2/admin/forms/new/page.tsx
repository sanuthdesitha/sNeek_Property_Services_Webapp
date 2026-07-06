import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { NewTemplate } from "@/components/v2/admin/forms/builder/new-template";

export const metadata = { title: "New form template · Estate admin" };
export const dynamic = "force-dynamic";

export default async function EstateNewFormPage() {
  await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
  return <NewTemplate />;
}
