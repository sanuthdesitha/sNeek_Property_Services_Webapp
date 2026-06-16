import { requireRole } from "@/lib/auth/session";
import { Role } from "@prisma/client";
import { ClientQuotesPage } from "@/components/client/client-quotes-page";

export const dynamic = "force-dynamic";

export default async function ClientQuotesRoute() {
  await requireRole([Role.CLIENT]);
  return <ClientQuotesPage />;
}
