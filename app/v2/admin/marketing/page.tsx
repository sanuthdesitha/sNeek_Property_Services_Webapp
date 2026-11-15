import { Role } from "@prisma/client";
import { ExternalLink } from "lucide-react";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { getMarketingCampaigns, getMarketingSubscriptionPlans } from "@/lib/marketing/store";
import { listEmailCampaigns } from "@/lib/marketing/email-campaigns";
import { getCampaignStats } from "@/lib/marketing/campaign-analytics";
import { campaignSendCounts } from "@/lib/marketing/campaign-reach";
import { getAppSettings } from "@/lib/settings";
import type { EmailCampaignRow, LibraryAssetRow, SocialPostRow } from "@/lib/marketing/workspace-types";
import { EPageHeader, EButton } from "@/components/v2/ui/primitives";
import { MarketingHub } from "@/components/v2/admin/marketing/marketing-hub";
import { listGroups } from "@/lib/marketing/social/groups";

export const metadata = { title: "Marketing · Estate admin" };
export const dynamic = "force-dynamic";

const iso = (value: Date | string | null | undefined) => (value ? new Date(value).toISOString() : null);

/** Campaign rows with ledger counts and the email service's reports ("not recorded" stays null). */
async function loadCampaignRows(): Promise<{ rows: EmailCampaignRow[]; failed: boolean }> {
  try {
    const campaigns = await listEmailCampaigns();
    const ids = campaigns.map((campaign) => campaign.id);
    const [sends, stats, eventGroups] = await Promise.all([
      campaignSendCounts(ids).catch(() => null),
      getCampaignStats(ids).catch(() => null),
      db.emailCampaignEvent.groupBy({ by: ["campaignId"], where: { campaignId: { in: ids } }, _count: { _all: true } }).catch(() => null),
    ]);
    const reported = new Set((eventGroups ?? []).filter((row) => row._count._all > 0).map((row) => row.campaignId));
    const rows = campaigns.map((campaign) => {
      const stat = stats?.[campaign.id];
      return {
        id: campaign.id,
        name: campaign.name,
        subject: campaign.subject,
        htmlBody: campaign.htmlBody,
        audience: campaign.audience,
        status: campaign.status,
        scheduledAt: iso(campaign.scheduledAt),
        sentAt: iso(campaign.sentAt),
        recipientCount: campaign.recipientCount,
        createdAt: iso(campaign.createdAt)!,
        updatedAt: iso(campaign.updatedAt)!,
        sends: sends ? sends[campaign.id] ?? { sent: 0, failed: 0, skipped: 0 } : null,
        report: stat && reported.has(campaign.id) ? { delivered: stat.delivered, opened: stat.opened, clicked: stat.clicked, bounced: stat.bounced } : null,
      } satisfies EmailCampaignRow;
    });
    return { rows, failed: false };
  } catch {
    return { rows: [], failed: true };
  }
}

/**
 * Marketing workspace (board "Marketing", 2026-11-16): email campaigns,
 * discounts and plans, social posts, templates and images. Growth keeps the
 * summary figures, lead stages and hiring; this page is the workspace.
 * ADMIN and OPS_MANAGER, as before; every API route keeps its own guard.
 */
export default async function V2AdminMarketingPage() {
  await requireRole([Role.ADMIN, Role.OPS_MANAGER]);

  const [discounts, plans, campaignLoad, socialPosts, assets, settings, socialGroups] = await Promise.all([
    getMarketingCampaigns().catch(() => null),
    getMarketingSubscriptionPlans().catch(() => null),
    loadCampaignRows(),
    // Posts written and posted by hand; posts made from jobs (with a group) are listed by group.
    db.socialPost.findMany({ where: { groupId: null }, orderBy: [{ createdAt: "desc" }], take: 200 }).catch(() => null),
    db.marketingAsset.findMany({ orderBy: [{ createdAt: "desc" }], take: 500 }).catch(() => null),
    getAppSettings(),
    listGroups().catch(() => null),
  ]);

  const socialPlain: SocialPostRow[] | null = socialPosts
    ? socialPosts.map((post) => ({
        id: post.id,
        channel: post.channel as SocialPostRow["channel"],
        caption: post.caption,
        status: String(post.status),
        scheduledFor: iso(post.scheduledFor),
        publishedAt: iso(post.publishedAt),
        externalUrl: post.externalUrl ?? null,
        createdAt: iso(post.createdAt)!,
      }))
    : null;
  const assetsPlain: LibraryAssetRow[] | null = assets
    ? assets.map((asset) => ({
        id: asset.id,
        name: asset.name,
        url: asset.url,
        mediaType: (asset.mediaType as LibraryAssetRow["mediaType"]) ?? "IMAGE",
        createdAt: iso(asset.createdAt)!,
      }))
    : null;

  return (
    <div className="space-y-5">
      <EPageHeader
        eyebrow="Money · Growth"
        title="Marketing"
        description="Email campaigns, discount codes, public plans, social posts (including posts made from finished jobs), templates and images. Growth shows the summary; this is the workspace."
        actions={
          <div className="flex flex-wrap gap-2">
            <EButton asChild variant="outline" size="sm">
              <a href="/quote" target="_blank" rel="noreferrer">Open quote page <ExternalLink className="h-3.5 w-3.5" aria-hidden /></a>
            </EButton>
            <EButton asChild variant="outline" size="sm">
              <a href="/subscriptions" target="_blank" rel="noreferrer">Open plans page <ExternalLink className="h-3.5 w-3.5" aria-hidden /></a>
            </EButton>
          </div>
        }
      />

      <MarketingHub
        discounts={discounts as any}
        plans={plans as any}
        emailCampaigns={campaignLoad.failed ? null : campaignLoad.rows}
        socialPosts={socialPlain}
        socialGroups={socialGroups}
        assets={assetsPlain}
        brand={{ companyName: settings.companyName || "sNeek Property Services", logoUrl: settings.logoUrl ?? "" }}
        timeZone={settings.timezone}
      />
    </div>
  );
}
