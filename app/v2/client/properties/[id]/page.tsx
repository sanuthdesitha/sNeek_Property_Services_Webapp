import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, NotebookPen } from "lucide-react";
import { PropertyCareWorkspace } from "@/components/property-care/workspace";
import { OperationsDisclosure } from "@/components/operations/ui";
import { requireClientPortalPage } from "@/lib/auth/client-portal";
import { getAppSettings } from "@/lib/settings";
import { getClientPortalContext } from "@/lib/client/portal";
import { getClientPropertyDetailForUser } from "@/lib/client/portal-data";
import { SegmentLinks } from "@/components/v2/client/portal/segment-links";
import { PropertyOverview } from "@/components/v2/client/property/property-overview";
import {
  ActivitySection, LaundrySection, PhotosSection, ReportsSection, StockSection, UpcomingSection,
} from "@/components/v2/client/property/property-sections";
import type { PropertyTab } from "@/components/v2/client/property/property-format";

export const metadata = { title: "Property · Estate client" };
export const dynamic = "force-dynamic";

const TAB_LABELS: Record<PropertyTab, string> = {
  overview: "Overview", reports: "Reports", photos: "Photos", stock: "Stock", laundry: "Laundry", care: "Care",
};

/**
 * Client property page (board 2): Overview, Reports, Photos, Stock, Laundry,
 * Care. Reports and Laundry left the phone tab bar and live here (and in More).
 * Same guard as the properties list (module + grant); a tab whose module is
 * switched off for this client is not offered, and an unknown or hidden
 * `?tab=` falls back to Overview.
 */
export default async function EstateClientPropertyDetailPage({
  params,
  searchParams,
}: {
  params: { id: string };
  searchParams?: { tab?: string };
}) {
  const portalCtx = await requireClientPortalPage({ module: "properties", permission: "properties" });
  const settings = await getAppSettings();
  const portal = await getClientPortalContext(portalCtx.userId, settings);
  const showReports = portal.visibility.showReports && (portalCtx.actor === "CLIENT" || portalCtx.permissions.reports);
  const detail = await getClientPropertyDetailForUser(portalCtx.userId, params.id, { ...portal.visibility, showReports });
  if (!detail) notFound();

  const visibility = portal.visibility;
  const tabs: PropertyTab[] = [
    "overview",
    ...(showReports ? (["reports"] as const) : []),
    "photos",
    ...(visibility.showInventory ? (["stock"] as const) : []),
    ...(visibility.showLaundryUpdates ? (["laundry"] as const) : []),
    "care",
  ];
  const requested = searchParams?.tab as PropertyTab | undefined;
  const tab: PropertyTab = requested && tabs.includes(requested) ? requested : "overview";
  const base = `/v2/client/properties/${encodeURIComponent(params.id)}`;
  const tabHref = (key: string) => (key === "overview" ? base : `${base}?tab=${key}`);
  const property = detail.property;
  const canBook = visibility.showBooking && (portalCtx.actor === "CLIENT" || portalCtx.permissions.bookings);

  return (
    <div className="space-y-4">
      <div className="flex items-start gap-3">
        <Link href="/v2/client/properties" aria-label="Back to properties" className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface))]">
          <ArrowLeft className="h-4 w-4" aria-hidden />
        </Link>
        <div className="min-w-0">
          <h1 className="e-display-md break-words">{property.name}</h1>
          <p className="text-[0.875rem] text-[hsl(var(--e-muted-foreground))]">
            {[property.suburb, `${property.bedrooms} bed · ${property.bathrooms} bath`].filter(Boolean).join(" · ")}
          </p>
          <p className="text-[0.75rem] text-[hsl(var(--e-text-faint))]">{property.address}, {property.suburb}, {property.state} {property.postcode}</p>
        </div>
      </div>

      <SegmentLinks variant="chips" label="Property sections" activeKey={tab}
        links={tabs.map((key) => ({ key, label: TAB_LABELS[key], href: tabHref(key) }))} />

      {tab === "overview" ? (
        <div className="grid gap-4 xl:grid-cols-[1.1fr_0.9fr]">
          <PropertyOverview detail={detail} tabHref={tabHref} flags={{
            showReports, showInventory: visibility.showInventory, showLaundry: visibility.showLaundryUpdates,
            showNames: visibility.showCleanerNames, showChecklistPreview: visibility.showChecklistPreview,
          }} />
          <div className="space-y-4">
            <UpcomingSection detail={detail} showNames={visibility.showCleanerNames} limit={3} />
            <ActivitySection detail={detail} limit={3} />
          </div>
        </div>
      ) : null}
      {tab === "reports" ? <ReportsSection detail={detail} showDownloads={visibility.showReportDownloads} limit={20} /> : null}
      {tab === "photos" ? <PhotosSection detail={detail} limit={6} /> : null}
      {tab === "stock" ? <StockSection detail={detail} /> : null}
      {tab === "laundry" ? <LaundrySection detail={detail} showImages={visibility.showLaundryImages} limit={10} /> : null}
      {tab === "care" ? (
        <OperationsDisclosure
          title="Planned and completed property care"
          description="Extra care booked for this property and what has been carried out."
          icon={<NotebookPen />}
        >
          <PropertyCareWorkspace propertyId={params.id} timeZone={settings.timezone} panel />
        </OperationsDisclosure>
      ) : null}

      {canBook ? (
        <div className="sticky bottom-[4.75rem] z-20 -mx-4 border-t border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface))] px-4 py-2.5 lg:static lg:mx-0 lg:border-0 lg:bg-transparent lg:px-0">
          <Link href="/v2/client/booking" className="flex min-h-12 w-full items-center justify-center rounded-[var(--e-radius)] bg-[hsl(var(--e-accent-portal))] text-[0.9375rem] font-[600] text-[hsl(var(--e-accent-portal-foreground))] lg:w-auto lg:px-6">
            Book a clean here
          </Link>
        </div>
      ) : null}
    </div>
  );
}
