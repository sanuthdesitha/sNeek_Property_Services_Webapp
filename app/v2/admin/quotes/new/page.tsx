import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { getAppSettings } from "@/lib/settings";
import { QuoteBuilder } from "@/components/v2/admin/quotes/quote-builder";
import { loadCaseQuotePrefill } from "@/lib/cases/repair-quote";
import { marginModelFrom, serviceOptions, timezoneFrom } from "@/lib/quotes/quote-page-data";

export const metadata = { title: "New quote · Estate admin" };
export const dynamic = "force-dynamic";

type SearchParams = { fromCase?: string | string[]; clientId?: string | string[]; leadId?: string | string[] };

const ID = /^[A-Za-z0-9_-]{1,200}$/;

function single(value: string | string[] | undefined): string | null {
  const raw = Array.isArray(value) ? value[0] : value;
  return raw && ID.test(raw) ? raw : null;
}
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
  // `?clientId=` (New quote from a client page) and `?leadId=` (Make quote from
  // the pipeline) preselect the recipient only when the record exists (an
  // inactive client is not offered). Anything else is ignored with a notice.
  const requestedClientId = single(searchParams?.clientId);
  const requestedLeadId = single(searchParams?.leadId);
  const [prefillClient, prefillLead] = await Promise.all([
    requestedClientId ? db.client.findFirst({ where: { id: requestedClientId, isActive: true }, select: { id: true, name: true, email: true, suburb: true } }) : null,
    requestedLeadId ? db.quoteLead.findUnique({ where: { id: requestedLeadId }, select: { id: true, name: true, email: true, suburb: true, serviceType: true, bedrooms: true, bathrooms: true, estimateMin: true, estimateMax: true } }) : null,
  ]);
  const prefillMissing = Boolean((requestedClientId && !prefillClient) || (requestedLeadId && !prefillLead));

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

  // The page heading ("New quote") is drawn by the quote full page; prefill
  // notices stay here so they render on the server with the page.
  return (
    <div className="space-y-4">
      {prefillMissing ? (
        <p role="alert" className="rounded-[var(--e-radius)] bg-[hsl(var(--e-warning-soft))] px-3 py-2 text-[0.8125rem]">
          The client or lead this quote was started for could not be found or is inactive, so no recipient was chosen.
        </p>
      ) : null}
      {fromCaseId && !casePrefill ? (
        <p role="alert" className="rounded-[var(--e-radius)] bg-[hsl(var(--e-warning-soft))] px-3 py-2 text-[0.8125rem]">
          The case this quote was started from could not be found, so nothing was filled in.
        </p>
      ) : null}
      <QuoteBuilder
        leads={(prefillLead && !leads.some((lead) => lead.id === prefillLead.id) ? [prefillLead, ...leads] : leads).map((lead) => ({ ...lead, email: lead.email ?? "", serviceType: lead.serviceType ? String(lead.serviceType) : null }))}
        clients={withCaseClient(
          withCaseClient(clients.map((c) => ({ id: c.id, name: c.name, email: c.email ?? "", suburb: c.suburb ?? null })), casePrefill?.client ?? null),
          prefillClient ? { id: prefillClient.id, name: prefillClient.name } : null,
        )}
        recipientPrefill={casePrefill ? undefined : { clientId: prefillClient?.id, leadId: prefillLead?.id }}
        services={serviceOptions()}
        gstEnabled={settings.pricing.gstEnabled}
        pricingVariables={settings.pricingVariables}
        casePrefill={casePrefill ?? undefined}
        marginModel={marginModelFrom(settings)}
        timezone={timezoneFrom(settings)}
      />
    </div>
  );
}
