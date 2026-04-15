import { PortalLayout } from "@/components/layout/portal-layout";
import { requireRole } from "@/lib/auth/session";

export default async function LaundryLayout({ children }: { children: React.ReactNode }) {
  await requireRole("LAUNDRY");
  return <PortalLayout portal="laundry">{children}</PortalLayout>;
}
