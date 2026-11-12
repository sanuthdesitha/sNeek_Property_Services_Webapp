import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { getAppSettings } from "@/lib/settings";
// Quotes and pricing (2026-11 redesign, board "Quotes and pricing"): leads and
// quotes as one server-paged list with stage chips, a side panel, and the rate
// card, price book, holiday rates, pricing variables and client rates as tabs.
// /v2/admin/pricing redirects to the Rate card tab.
import { QuotesWorkspace } from "@/components/v2/admin/quotes/pipeline/quotes-workspace";
import { parseQuotesTab } from "@/lib/quotes/quotes-tabs";
import { SERVICE_CATALOG } from "@/lib/pricing/service-catalog";

export const metadata = { title: "Quotes and pricing · Estate admin" };
export const dynamic = "force-dynamic";

export default async function V2AdminQuotesPage({ searchParams }: { searchParams?: { tab?: string } }) {
  const session = await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
  const isAdmin = session.user.role === Role.ADMIN;
  const [settings, newLeads] = await Promise.all([
    getAppSettings(),
    db.quoteLead.count({ where: { status: "NEW", quotes: { none: {} } } }).catch(() => null),
  ]);
  return (
    <QuotesWorkspace
      initialTab={parseQuotesTab(searchParams?.tab)}
      isAdmin={isAdmin}
      newLeads={newLeads}
      pricingVariables={settings.pricingVariables}
      timezone={settings.timezone ?? "Australia/Sydney"}
      services={SERVICE_CATALOG.map((service) => ({ value: String(service.jobType), label: service.label }))}
    />
  );
}
