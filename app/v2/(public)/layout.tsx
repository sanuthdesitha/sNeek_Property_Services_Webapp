import { getAppSettings } from "@/lib/settings";
import { EstatePublicShell } from "@/components/v2/public/estate-public-shell";

/**
 * v2 public layout — wraps every marketing page in the Estate public shell
 * (header, footer, WhatsApp FAB). Nested under app/v2/layout.tsx which mounts
 * [data-skin="estate"] and the ThemeProvider, so no duplication here.
 */
export default async function V2PublicLayout({ children }: { children: React.ReactNode }) {
  const settings = await getAppSettings().catch(() => null);
  const companyName = settings?.companyName || "sNeek Property Services";
  const logoUrl = settings?.logoUrl ?? null;

  return (
    <EstatePublicShell companyName={companyName} logoUrl={logoUrl}>
      {children}
    </EstatePublicShell>
  );
}
