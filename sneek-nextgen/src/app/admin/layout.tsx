import { AdminLayout } from "@/components/layout/admin-layout";
import { requireRole } from "@/lib/auth/session";

export default async function AdminRootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await requireRole("ADMIN", "OPS_MANAGER");
  return <AdminLayout>{children}</AdminLayout>;
}
