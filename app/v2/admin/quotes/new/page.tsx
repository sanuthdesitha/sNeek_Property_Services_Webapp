import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { getAppSettings } from "@/lib/settings";
import { SERVICE_CATALOG } from "@/lib/pricing/service-catalog";
import { EPageHeader } from "@/components/v2/ui/primitives";
import { QuoteBuilder } from "@/components/v2/admin/quotes/quote-builder";
import { loadCaseQuotePrefill } from "@/lib/cases/repair-quote";

export const metadata = { title: "New quote · Estate admin" };
export const dynamic = "force-dynamic";

type SearchParams = { fromCase?: string | string[] };
type ClientOption = { id: string; name: string; email: string; suburb: string | null };

/** The case's client stays choosable even when it is outside the first 500 active clients. */
function withCaseClient(clients: ClientOption[], caseClient: { id: string; name: string } | null): ClientOption[] {
  if (!caseClient || clients.some((client) => client.id === caseClient.id)) return clients;
  return [{ id: caseClient.id, name: caseClient.name, email: "", suburb: null }, ...clients];
}

/**
 * `?fromCase=<caseId>` (Cases "Create repair quote") pre-fills the builder on
 * the server from the case, re-read here with the same roles the quotes pages
 * allow. A missing case shows a notice and an empty builder. Nothing is sent.
 */
export default async function V2NewQuotePage({ searchParams }: { searchParams?: SearchParams }) {
  await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
  const rawCase = Array.isArray(searchParams?.fromCase) ? searchParams?.fromCase[0] : searchParams?.fromCase;
  const fromCaseId = rawCase && /^[A-Za-z0-9_-]{1,200}$/.test(rawCase) ? rawCase : null;
  const casePrefill = fromCaseId ? await loadCaseQuotePrefill(fromCaseId) : null;

  const [leads, clients, settings] = await Promise.all([
    db.quoteLead.findMany({
      orderBy: { createdAt: "desc" },
      take: 200,
      select: {
        id: true,
        name: true,
        email: true,
        suburb: true,
        serviceType: true,
        bedrooms: true,
        bathrooms: true,
        estimateMin: true,
        estimateMax: true,
      },
    }),
    db.client.findMany({
      where: { isActive: true },
      orderBy: { name: "asc" },
      take: 500,
      select: { id: true, name: true, email: true, suburb: true },
    }),
    getAppSettings(),
  ]);

  const serviceOptions = SERVICE_CATALOG.map((c) => ({
    jobType: c.jobType as string,
    label: c.label,
    model: c.model,
    itemLabel: c.itemLabel ?? null,
    unitLabel: c.unitLabel ?? null,
    bands: (c.rate.bands ?? []).map((b) => ({ label: b.label })),
  }));

  return (
    <div className="space-y-6">
      <EPageHeader
        eyebrow="Growth"
        title="New quote"
        description="Quote an existing client or a new lead, priced per service from your rate card."
      />
      {fromCaseId && !casePrefill ? (
        <p role="alert" className="rounded-[var(--e-radius)] bg-[hsl(var(--e-warning-soft))] px-3 py-2 text-[0.8125rem]">
          The case this quote was started from could not be found, so nothing was filled in.
        </p>
      ) : null}
      <QuoteBuilder
        leads={leads}
        clients={withCaseClient(clients.map((c) => ({ id: c.id, name: c.name, email: c.email ?? "", suburb: c.suburb ?? null })), casePrefill?.client ?? null)}
        services={serviceOptions}
        gstEnabled={settings.pricing.gstEnabled}
        pricingVariables={settings.pricingVariables}
        casePrefill={casePrefill ?? undefined}
      />
    </div>
  );
}
