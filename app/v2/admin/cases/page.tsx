import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { AdminCasesWorkspace } from "@/components/cases/admin-cases-workspace";

export const metadata = { title: "Cases · Estate admin" };
export const dynamic = "force-dynamic";

export default async function V2AdminCasesPage() {
  await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
  // Reuse the exact legacy cases workspace (self-contained client component with
  // its own data fetching and mutations), mounted inside the Estate admin shell.
  return (
    <div className="space-y-6">
      <AdminCasesWorkspace />
    </div>
  );
}
