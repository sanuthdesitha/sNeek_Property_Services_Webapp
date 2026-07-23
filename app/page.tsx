import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import type { Metadata } from "next";
import { getSession } from "@/lib/auth/session";
import { getDefaultPortalVersion } from "@/lib/portal-version-store";
import { PORTAL_VERSION_COOKIE, effectivePortalVersion, parsePortalVersion } from "@/lib/portal-version";
import { Role } from "@prisma/client";
import { getAppSettings } from "@/lib/settings";
import { PublicSiteShell } from "@/components/public/public-site-shell";
import { HomePage as MarketingHomePage } from "@/components/public/home-page";
import { listPublishedBlogPosts } from "@/lib/public-site/blog";
import { isWebsiteInMaintenance } from "@/lib/public-site/routing";
import { MaintenancePage } from "@/components/public/maintenance-page";
import { getPublicWidgetFlags } from "@/lib/public-site/widgets";
import { PublicThemeProvider } from "@/components/public/public-theme";
import { SmoothScroll } from "@/components/public/smooth-scroll";

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || "https://sneekproservices.com.au";

export const metadata: Metadata = {
  alternates: { canonical: SITE_URL },
  openGraph: {
    type: "website",
    url: SITE_URL,
    title: "sNeek Property Services | Professional Cleaning & Property Care Sydney",
    description:
      "Professional cleaning, Airbnb turnovers, property reports, laundry coordination, and practical property support across Greater Sydney.",
    siteName: "sNeek Property Services",
  },
  twitter: {
    card: "summary_large_image",
    title: "sNeek Property Services",
    description:
      "Professional cleaning, Airbnb turnovers, property reports, laundry coordination, and practical property support across Greater Sydney.",
  },
};

const localBusinessJsonLd = {
  "@context": "https://schema.org",
  "@type": "LocalBusiness",
  "@id": `${SITE_URL}/#business`,
  name: "sNeek Property Services",
  description:
    "Professional cleaning, Airbnb turnovers, property reports, laundry coordination, and end-of-lease cleaning across Greater Sydney.",
  url: SITE_URL,
  telephone: "+61451217210",
  email: "info@sneekproservices.com.au",
  address: {
    "@type": "PostalAddress",
    streetAddress: "Parramatta",
    addressLocality: "Parramatta",
    addressRegion: "NSW",
    postalCode: "2150",
    addressCountry: "AU",
  },
  areaServed: {
    "@type": "GeoCircle",
    geoMidpoint: { "@type": "GeoCoordinates", latitude: -33.8148, longitude: 151.0017 },
    geoRadius: "50000",
  },
  priceRange: "$$",
  openingHoursSpecification: [
    {
      "@type": "OpeningHoursSpecification",
      dayOfWeek: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"],
      opens: "07:00",
      closes: "18:00",
    },
    {
      "@type": "OpeningHoursSpecification",
      dayOfWeek: ["Saturday"],
      opens: "08:00",
      closes: "16:00",
    },
  ],
  sameAs: [
    "https://www.instagram.com/sneekproservices",
    "https://www.facebook.com/sneekproservices",
  ],
};

export default async function HomePage() {
  const session = await getSession();

  if (!session) {
    const settings = await getAppSettings();
    const companyName = settings.companyName || "sNeek Property Services";
    const latestBlogPosts =
      settings.websiteContent.pageVisibility.blog !== false ? await listPublishedBlogPosts() : [];
    const widgetFlags = await getPublicWidgetFlags();

    return (
      <>
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(localBusinessJsonLd) }}
        />
        <PublicThemeProvider>
          {/* Lenis smooth scroll + the public theme/serif scope, mirroring the
              (public) route group layout so the home page reads identically. */}
          <SmoothScroll>
            <div className="marketing-only" data-portal-theme="public">
              <PublicSiteShell companyName={companyName} logoUrl={settings.logoUrl} content={settings.websiteContent}>
                {isWebsiteInMaintenance(settings.websiteContent) ? (
                  <MaintenancePage content={settings.websiteContent} />
                ) : (
                  <MarketingHomePage
                    content={settings.websiteContent}
                    latestBlogPosts={latestBlogPosts.slice(0, 3)}
                    widgetFlags={widgetFlags}
                  />
                )}
              </PublicSiteShell>
            </div>
          </SmoothScroll>
        </PublicThemeProvider>
      </>
    );
  }

  // Signed-in users get sent to their portal in the current look. This is the
  // landing spot for the classic sign-in flow, so it is where "make v2 the
  // default" has to be honoured — otherwise everyone would touch down in v1
  // and only then be bounced.
  //
  // QA_INSPECTOR and MAINTENANCE were missing here and fell through to
  // /login, which middleware then bounced straight back — a redirect loop for
  // those two roles. Every role is now covered.
  const role = session.user.role as Role;
  const look = effectivePortalVersion(
    await getDefaultPortalVersion(),
    parsePortalVersion(cookies().get(PORTAL_VERSION_COOKIE)?.value),
  );
  const v2 = look === "v2";
  if (role === Role.ADMIN || role === Role.OPS_MANAGER) return redirect(v2 ? "/v2/admin" : "/admin");
  if (role === Role.CLEANER) return redirect(v2 ? "/v2/cleaner" : "/cleaner");
  if (role === Role.CLIENT) return redirect(v2 ? "/v2/client" : "/client");
  if (role === Role.LAUNDRY) return redirect(v2 ? "/v2/laundry" : "/laundry");
  if (role === Role.QA_INSPECTOR) return redirect(v2 ? "/v2/qa" : "/qa");
  if (role === Role.MAINTENANCE) return redirect(v2 ? "/v2/maintenance" : "/maintenance");

  return redirect("/login");
}

