import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { CasesWorkspace } from "@/components/v2/admin/cases/cases-workspace";

export const metadata = { title: "Cases · Estate admin" };
export const dynamic = "force-dynamic";

// Estate-native cases workspace — full CRUD parity with the legacy workspace
// against the same /api/admin/cases endpoints. Zero v1 UI imports.
export default async function V2AdminCasesPage() {
  await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
  return <CasesWorkspace />;
}
