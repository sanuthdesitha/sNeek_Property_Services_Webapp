import Link from "next/link";
import { requireClientPortalPage } from "@/lib/auth/client-portal";
import { listClientPropertiesForUser } from "@/lib/client/portal-data";
import { loadPropertyHomeRows } from "@/lib/client/property-home";
import { requirePropertyFavoritesContext } from "@/lib/client/property-favorites-store";
import { PropertyPortfolio } from "@/components/v2/client/property-portfolio";
import {
  EBadge,
  ECard,
  ECardBody,
  EEmptyState,
  EPageHeader,
} from "@/components/v2/ui/primitives";
import { Building2, ClipboardList, Package } from "lucide-react";

export const metadata = { title: "Properties · Estate client" };
export const dynamic = "force-dynamic";

export default async function ClientPropertiesPage() {
  const portalCtx = await requireClientPortalPage({ module: "properties", permission: "properties" });
  // Shim: downstream code reads session.user.id — for a VA that is THEIR id,
  // and the VA-aware resolvers scope it to their team's client and properties.
  const session = { user: { id: portalCtx.userId, name: portalCtx.userName } };
  const properties = await listClientPropertiesForUser(session.user.id).catch(() => []);
  // The pinned portfolio (next clean, last service, approvals per home) moved
  // here from Home when Home became the drawn phone screen and dashboard; pins
  // and the cards/compact choice are unchanged.
  const portfolio = await loadPropertyHomeRows(portalCtx).catch(() => null);
  const favoritesContext = portfolio && portfolio.length > 0
    ? await requirePropertyFavoritesContext().then((value) => value.context).catch(() => null)
    : null;

  return (
    <div className="space-y-6">
      <EPageHeader
        eyebrow="Your homes"
        title="Properties"
        description="Inventory, supplies, and service history live inside each property."
      />

      <section aria-labelledby="portfolio-heading" className="space-y-3">
        <h2 id="portfolio-heading" className="e-display-sm">Your portfolio</h2>
        {portfolio === null ? (
          <p className="text-sm text-[hsl(var(--e-muted-foreground))]">Property summaries unavailable. <a className="underline" href="/v2/client/properties">Retry</a></p>
        ) : portfolio.length === 0 ? null : (
          <PropertyPortfolio
            rows={portfolio}
            expectedContext={favoritesContext}
            scope={JSON.stringify([portalCtx.userId, portalCtx.clientId, portalCtx.actor, portalCtx.team?.id, portalCtx.propertyIds, portalCtx.visibility])}
          />
        )}
      </section>

      <h2 className="e-display-sm">Addresses and details</h2>
      {properties.length === 0 ? (
        <EEmptyState
          eyebrow="Nothing yet"
          title="No properties on file"
          description="Properties linked to your account will appear here."
        />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {properties.map((p) => (
            <Link key={p.id} href={`/v2/client/properties/${p.id}`} className="group block">
              <ECard className="h-full transition-colors duration-[160ms] group-hover:border-[hsl(var(--e-gold))]">
              <ECardBody className="space-y-3 pt-6">
                <div className="flex items-start justify-between">
                  <span className="flex h-10 w-10 items-center justify-center rounded-[var(--e-radius)] border border-[hsl(var(--e-border-strong))] text-[hsl(var(--e-accent-portal))]">
                    <Building2 className="h-5 w-5" />
                  </span>
                  <EBadge tone={p.inventoryEnabled ? "primary" : "neutral"} soft>
                    {p.inventoryEnabled ? "Inventory tracked" : "Active"}
                  </EBadge>
                </div>
                <div>
                  <p className="text-[1rem] font-[550]">{p.name}</p>
                  <p className="text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">
                    {[p.address, p.suburb].filter(Boolean).join(", ")}
                  </p>
                </div>
                <div className="e-signature-rule" />
                <div className="grid grid-cols-2 gap-3 text-[0.8125rem] text-[hsl(var(--e-text-secondary))]">
                  <span className="flex items-center gap-2">
                    <ClipboardList className="h-4 w-4 text-[hsl(var(--e-text-faint))]" />
                    {p._count.jobs} job{p._count.jobs === 1 ? "" : "s"}
                  </span>
                  <span className="flex items-center gap-2">
                    <Package className="h-4 w-4 text-[hsl(var(--e-text-faint))]" />
                    {p.bedrooms}bd · {p.bathrooms}ba
                  </span>
                </div>
              </ECardBody>
              </ECard>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
