import { getAppSettings } from "@/lib/settings";
import { PublicSiteShell } from "@/components/public/public-site-shell";
import { isWebsiteInMaintenance } from "@/lib/public-site/routing";
import { MaintenancePage } from "@/components/public/maintenance-page";

export default async function PublicLayout({ children }: { children: React.ReactNode }) {
  const settings = await getAppSettings();
  const companyName = settings.companyName || "sNeek Property Services";
  const content = settings.websiteContent;

  return (
    <PublicSiteShell companyName={companyName} logoUrl={settings.logoUrl} content={content}>
      {isWebsiteInMaintenance(content) ? <MaintenancePage content={content} /> : children}
    </PublicSiteShell>
  );
}
