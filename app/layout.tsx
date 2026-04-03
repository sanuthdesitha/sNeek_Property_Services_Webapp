import type { Metadata, Viewport } from "next";
import { kickWebScheduledOps } from "@/lib/ops/web-scheduler";
import "./globals.css";
import { Providers } from "./providers";

export const metadata: Metadata = {
  title: {
    default: "sNeek Property Services",
    template: "%s | sNeek Property Services",
  },
  description: "Professional cleaning, Airbnb turnovers, property reports, laundry coordination, and practical property support across Sydney.",
  manifest: "/manifest.json",
  icons: {
    icon: [{ url: "/icon", type: "image/svg+xml", sizes: "64x64" }],
    apple: [{ url: "/icon", type: "image/svg+xml", sizes: "64x64" }],
    shortcut: ["/icon"],
  },
  appleWebApp: { capable: true, statusBarStyle: "default", title: "sNeek Property Services" },
};

export const viewport: Viewport = {
  themeColor: "#0284c7",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
};

export const dynamic = "force-dynamic";

export default function RootLayout({ children }: { children: React.ReactNode }) {
  kickWebScheduledOps();

  return (
    <html lang="en" suppressHydrationWarning>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
