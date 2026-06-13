import { getAppSettings } from "@/lib/settings";
import { PublicSiteShell } from "@/components/public/public-site-shell";
import { isWebsiteInMaintenance } from "@/lib/public-site/routing";
import { MaintenancePage } from "@/components/public/maintenance-page";
import { PublicThemeProvider } from "@/components/public/public-theme";
import { SmoothScroll } from "@/components/public/smooth-scroll";

export default async function PublicLayout({ children }: { children: React.ReactNode }) {
  const settings = await getAppSettings();
  const companyName = settings.companyName || "sNeek Property Services";
  const content = settings.websiteContent;

  return (
    <PublicThemeProvider>
      {/* Lenis smooth scroll is scoped to public routes only and respects
          prefers-reduced-motion (see SmoothScroll). */}
      <SmoothScroll>
        <div className="marketing-only" data-portal-theme="public">
          <PublicSiteShell companyName={companyName} logoUrl={settings.logoUrl} content={content}>
            {isWebsiteInMaintenance(content) ? <MaintenancePage content={content} /> : children}
          </PublicSiteShell>
        </div>
      </SmoothScroll>
    </PublicThemeProvider>
  );
}
