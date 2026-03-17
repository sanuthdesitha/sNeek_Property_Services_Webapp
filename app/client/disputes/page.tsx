import { ensureClientModuleAccess } from "@/lib/portal-access";
import { ClientDisputesPage } from "@/components/client/disputes-page";

export default async function Page() {
  await ensureClientModuleAccess("disputes");
  return <ClientDisputesPage />;
}

