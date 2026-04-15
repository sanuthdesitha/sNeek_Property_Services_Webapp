import { PortalLayout } from "@/components/layout/portal-layout";
import { requireRole } from "@/lib/auth/session";

export default async function CleanerLayout({ children }: { children: React.ReactNode }) {
  await requireRole("CLEANER");
  return <PortalLayout portal="cleaner">{children}</PortalLayout>;
}
