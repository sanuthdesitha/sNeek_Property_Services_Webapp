import type { Metadata, Viewport } from "next";
import { Inter, JetBrains_Mono, Cormorant_Garamond, Fraunces } from "next/font/google";
import { kickWebScheduledOps } from "@/lib/ops/web-scheduler";
import "./globals.css";
import { Providers } from "./providers";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth/auth-options";
import { getThemeForUser } from "@/lib/theme/server";
import { getImpersonationBanner, ImpersonationSlot } from "@/components/admin/impersonation-slot";

const fontSans = Inter({
  subsets: ["latin"],
  variable: "--font-sans",
  display: "swap",
});

const fontDisplay = Inter({
  subsets: ["latin"],
  variable: "--font-display",
  weight: ["500", "600", "700"],
  display: "swap",
});

const fontMono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
  weight: ["400", "500"],
  display: "swap",
});

// Luxury display serif for the PUBLIC marketing site only. Applied via the
// `.marketing-only` scope in globals.css so the admin/portal apps keep Inter.
const fontDisplaySerif = Cormorant_Garamond({
  subsets: ["latin"],
  variable: "--font-display-serif",
  weight: ["400", "500", "600", "700"],
  style: ["normal", "italic"],
  display: "swap",
});

// ESTATE rebrand (v2) display serif — optical-size variable Fraunces. Loaded
// here so it's available app-wide, but only CONSUMED under the `[data-skin=
// "estate"]` scope (app/v2/**), so the live app is visually unaffected.
const fontEstateSerif = Fraunces({
  subsets: ["latin"],
  variable: "--font-estate-serif",
  weight: ["300", "400", "500", "600", "700"],
  style: ["normal", "italic"],
  display: "swap",
});

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || "https://sneekproservices.com.au";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: "sNeek Property Services",
    template: "%s | sNeek Property Services",
  },
  description: "Professional cleaning, Airbnb turnovers, property reports, laundry coordination, and practical property support across Sydney.",
  manifest: "/manifest.json",
  icons: {
    icon: [
      { url: "/favicon.ico", type: "image/png", sizes: "192x192" },
      { url: "/icon", type: "image/svg+xml", sizes: "any" },
      { url: "/icon-192.png", type: "image/png", sizes: "192x192" },
      { url: "/icon-512.png", type: "image/png", sizes: "512x512" },
    ],
    apple: [{ url: "/icon-192.png", type: "image/png", sizes: "192x192" }],
    shortcut: [{ url: "/favicon.ico", type: "image/png", sizes: "192x192" }],
  },
  appleWebApp: { capable: true, statusBarStyle: "default", title: "sNeek Property Services" },
};

export const viewport: Viewport = {
  themeColor: "#0284c7",
  width: "device-width",
  initialScale: 1,
  // Do NOT set maximumScale/userScalable=false — disabling pinch-zoom is a
  // WCAG 1.4.4 violation (axe rule: meta-viewport). Let users zoom the page.
};

export const dynamic = "force-dynamic";

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  kickWebScheduledOps();

  // Resolve user's persisted theme preference for SSR. For "system" we default
  // to light on the server and let the pre-hydration script swap to dark if the
  // OS prefers dark — this prevents a flash-of-wrong-theme.
  const session = await getServerSession(authOptions);
  const themePref = await getThemeForUser((session as any)?.user?.id);
  // Admin "test as": the class drives the layout offsets in globals.css so the
  // fixed warning bar pushes the page (and any sticky portal header) down
  // rather than covering it.
  const impersonation = await getImpersonationBanner();
  const initialClass = `${themePref === "dark" ? "dark" : "light"}${impersonation ? " impersonating" : ""}`;

  // Pre-hydration script: resolves "system" against the OS preference and
  // applies .dark before paint. Uses the cookie/localStorage written by the
  // ThemeProvider as the authoritative source on the client.
  const preHydrationScript = `
(function() {
  try {
    var pref = ${JSON.stringify(themePref)};
    var resolved;
    if (pref === "system") {
      resolved = window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
    } else {
      resolved = pref;
    }
    var html = document.documentElement;
    html.classList.toggle("dark", resolved === "dark");
  } catch (e) {}
})();
`;

  return (
    <html lang="en" className={initialClass} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: preHydrationScript }} />
      </head>
      <body className={`${fontSans.variable} ${fontDisplay.variable} ${fontDisplaySerif.variable} ${fontEstateSerif.variable} ${fontMono.variable} antialiased`}>
        {/* Admin "test as" banner. Renders nothing (and hits no database)
            unless an impersonation ticket is active; when it does render it
            adds .has-impersonation-bar to <html> so sticky portal headers are
            pushed below it instead of hiding underneath. */}
        {impersonation ? <ImpersonationSlot banner={impersonation} /> : null}
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
