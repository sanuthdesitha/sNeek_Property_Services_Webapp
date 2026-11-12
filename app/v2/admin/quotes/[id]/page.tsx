import { notFound } from "next/navigation";
import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { getAppSettings } from "@/lib/settings";
import { caseForQuoteDetail } from "@/lib/cases/repair-quote";
import { loadBuilderLists, loadQuoteSnapshot, marginModelFrom, serviceOptions, timezoneFrom } from "@/lib/quotes/quote-page-data";
import { QuoteFullPage } from "@/components/v2/admin/quotes/full/quote-full-page";

export const metadata = { title: "Quote · Estate admin" };
export const dynamic = "force-dynamic";

/**
 * Quote full page (board "Quote full page: detail and edit combined"): view
 * and edit one quote. `/v2/admin/quotes/[id]/edit` redirects here. Same roles
 * as before; every write goes through the existing quote routes.
 */
export default async function V2QuoteDetailPage({ params }: { params: { id: string } }) {
  await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
  const snapshot = await loadQuoteSnapshot(params.id);
  if (!snapshot) notFound();

  const [lists, settings, fromCase] = await Promise.all([loadBuilderLists(), getAppSettings(), caseForQuoteDetail(snapshot.id)]);
  // The quote's own client stays choosable even when inactive or outside the first 500.
  const clients = snapshot.client && !lists.clients.some((client) => client.id === snapshot.client!.id)
    ? [{ id: snapshot.client.id, name: snapshot.client.name, email: snapshot.client.email, suburb: snapshot.client.suburb ?? null }, ...lists.clients]
    : lists.clients;

  return (
    <QuoteFullPage
      initial={snapshot}
      builderOptions={{
        leads: lists.leads,
        clients,
        services: serviceOptions(),
        gstEnabled: settings.pricing.gstEnabled,
        pricingVariables: settings.pricingVariables,
      }}
      marginModel={marginModelFrom(settings)}
      timezone={timezoneFrom(settings)}
      fromCase={fromCase}
    />
  );
}
