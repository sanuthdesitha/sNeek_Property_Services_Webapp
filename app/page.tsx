import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { Role } from "@prisma/client";
import { getAppSettings } from "@/lib/settings";
import { PublicSiteShell } from "@/components/public/public-site-shell";
import { HomePage as MarketingHomePage } from "@/components/public/home-page";

export default async function HomePage() {
  const session = await getSession();

  if (!session) {
    const settings = await getAppSettings();
    const companyName = settings.companyName || "sNeek Property Services";
    return (
      <PublicSiteShell companyName={companyName} logoUrl={settings.logoUrl} content={settings.websiteContent}>
        <MarketingHomePage content={settings.websiteContent} />
      </PublicSiteShell>
    );
  }

  const role = session.user.role as Role;
  if (role === Role.ADMIN || role === Role.OPS_MANAGER) return redirect("/admin");
  if (role === Role.CLEANER) return redirect("/cleaner");
  if (role === Role.CLIENT) return redirect("/client");
  if (role === Role.LAUNDRY) return redirect("/laundry");

  return redirect("/login");
}
