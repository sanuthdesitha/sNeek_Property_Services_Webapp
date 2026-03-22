import { ensureClientModuleAccess } from "@/lib/portal-access";
import { ClientCasesWorkspace } from "@/components/cases/client-cases-workspace";

export default async function ClientCasesPage() {
  await ensureClientModuleAccess("cases");
  return <ClientCasesWorkspace />;
}

