import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { getMarketingCampaigns, getMarketingSubscriptionPlans } from "@/lib/marketing/store";
import { listEmailCampaigns } from "@/lib/marketing/email-campaigns";
import { EPageHeader, EButton } from "@/components/v2/ui/primitives";
import { MarketingHub } from "@/components/v2/admin/marketing/marketing-hub";

export const metadata = { title: "Marketing · Estate admin" };
export const dynamic = "force-dynamic";

export default async function V2AdminMarketingPage() {
  await requireRole([Role.ADMIN, Role.OPS_MANAGER]);

  const [campaigns, plans, emailCampaigns, socialPosts, assets] = await Promise.all([
    getMarketingCampaigns().catch(() => []),
    getMarketingSubscriptionPlans().catch(() => []),
    listEmailCampaigns().catch(() => []),
    (db as any).socialPost
      .findMany({ orderBy: [{ createdAt: "desc" }], take: 200 })
      .catch(() => []),
    (db as any).marketingAsset
      .findMany({ orderBy: [{ createdAt: "desc" }], take: 500 })
      .catch(() => []),
  ]);

  // Serialize dates to plain strings for the client components.
  const socialPlain = (socialPosts as any[]).map((p) => ({
    id: p.id,
    channel: p.channel,
    caption: p.caption,
    status: p.status,
    scheduledFor: p.scheduledFor ? new Date(p.scheduledFor).toISOString() : null,
    publishedAt: p.publishedAt ? new Date(p.publishedAt).toISOString() : null,
    externalUrl: p.externalUrl ?? null,
    createdAt: new Date(p.createdAt).toISOString(),
  }));
  const assetsPlain = (assets as any[]).map((a) => ({
    id: a.id,
    name: a.name,
    url: a.url,
    mediaType: a.mediaType,
    createdAt: new Date(a.createdAt).toISOString(),
  }));

  return (
    <div className="space-y-6">
      <EPageHeader
        eyebrow="Growth"
        title="Marketing"
        description="Discount campaigns, public subscription plans, broadcast email, social posts, and the asset library — all driving the live public site."
        actions={
          <div className="flex flex-wrap gap-2">
            <EButton asChild variant="outline" size="sm">
              <a href="/quote" target="_blank" rel="noreferrer">Open quote page</a>
            </EButton>
            <EButton asChild variant="outline" size="sm">
              <a href="/subscriptions" target="_blank" rel="noreferrer">Open subscriptions</a>
            </EButton>
          </div>
        }
      />

      <MarketingHub
        campaigns={campaigns as any[]}
        plans={plans as any[]}
        emailCampaigns={emailCampaigns as any[]}
        socialPosts={socialPlain}
        assets={assetsPlain}
      />
    </div>
  );
}
