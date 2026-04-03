import { getAppSettings } from "@/lib/settings";
import { PublicSiteShell } from "@/components/public/public-site-shell";

export default async function PublicLayout({ children }: { children: React.ReactNode }) {
  const settings = await getAppSettings();
  const companyName = settings.companyName || "sNeek Property Services";

  return (
    <PublicSiteShell companyName={companyName} logoUrl={settings.logoUrl} content={settings.websiteContent}>
      {children}
    </PublicSiteShell>
  );
}
