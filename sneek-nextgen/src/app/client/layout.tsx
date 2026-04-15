import { PortalLayout } from "@/components/layout/portal-layout";
import { requireRole } from "@/lib/auth/session";

export default async function ClientLayout({ children }: { children: React.ReactNode }) {
  await requireRole("CLIENT");
  return <PortalLayout portal="client">{children}</PortalLayout>;
}
