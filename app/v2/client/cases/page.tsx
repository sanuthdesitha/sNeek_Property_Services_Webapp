import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { ensureClientModuleAccess } from "@/lib/portal-access";
import { EPageHeader } from "@/components/v2/ui/primitives";
import { ClientCasesWorkspace } from "@/components/v2/client/cases-workspace";

export const metadata = { title: "Cases · Estate client" };
export const dynamic = "force-dynamic";

export default async function V2ClientCasesRoute() {
  await ensureClientModuleAccess("cases");
  await requireRole([Role.CLIENT]);

  return (
    <div className="space-y-6">
      <EPageHeader
        eyebrow="Support"
        title="Cases &amp; disputes"
        description="Open a case for issues or disputes, and follow every update in one thread."
      />
      <ClientCasesWorkspace />
    </div>
  );
}
