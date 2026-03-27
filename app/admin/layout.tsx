import { AdminSidebar } from "@/components/admin/sidebar";
import { AdminHeader } from "@/components/admin/header";
import { getAppSettings } from "@/lib/settings";
import { requireRole } from "@/lib/auth/session";
import { Role } from "@prisma/client";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const session = await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
  const settings = await getAppSettings();

  return (
    <div className="relative flex h-screen overflow-hidden bg-background">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_76%_5%,rgba(31,158,170,0.18),transparent_24%),radial-gradient(circle_at_3%_34%,rgba(255,177,95,0.18),transparent_28%)]" />
      <AdminSidebar
        companyName={settings.companyName}
        logoUrl={settings.logoUrl}
        userName={session.user.name}
        userImage={session.user.image}
        className="hidden md:flex"
      />
      <div className="relative z-10 flex min-w-0 flex-1 flex-col overflow-hidden">
        <AdminHeader companyName={settings.companyName} logoUrl={settings.logoUrl} />
        <main className="page-fade flex-1 overflow-y-auto px-3 py-4 sm:px-4 md:px-6 md:py-6">{children}</main>
      </div>
    </div>
  );
}
