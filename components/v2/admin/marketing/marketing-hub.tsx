"use client";

/**
 * Marketing workspace tabs (board "Marketing", 2026-11-16): Email campaigns
 * first, then Discounts and plans, Social posts, Templates and Images. The
 * tab lives in `?tab=` so links keep working (older section names map to the
 * new tabs). Each tab mounts when chosen.
 */
import * as React from "react";
import { MarketingCampaignsManager } from "@/components/v2/admin/marketing/campaigns-manager";
import { EmailCampaignsManager } from "@/components/v2/admin/marketing/email-campaigns-manager";
import { TemplateGallery } from "@/components/v2/admin/marketing/template-gallery";
import { SocialTab, type SocialGroupRow } from "@/components/v2/admin/marketing/social/social-tab";
import { AssetLibrary } from "@/components/v2/admin/marketing/asset-library";
import { useEstateToast, EToastViewport } from "@/components/v2/admin/marketing/toast";
import type { BrandChrome } from "@/components/v2/admin/marketing/email-block-editor";
import { toneNoticeClass } from "@/components/v2/ui/tone-band";
import {
  MARKETING_TABS,
  marketingTabFromParam,
  type EmailCampaignRow,
  type LibraryAssetRow,
  type MarketingTab,
  type SocialPostRow,
} from "@/lib/marketing/workspace-types";

function writeTabParam(tab: MarketingTab) {
  const url = new URL(window.location.href);
  url.searchParams.set("tab", tab);
  url.searchParams.delete("open");
  window.history.replaceState(window.history.state, "", url.toString());
}

function LoadFailed({ what }: { what: string }) {
  return (
    <div role="alert" className={`rounded-[var(--e-radius-lg)] p-4 text-[0.8125rem] ${toneNoticeClass("problem")}`}>
      {what} could not be loaded. Reload the page to try again.
    </div>
  );
}

export function MarketingHub({
  discounts,
  plans,
  emailCampaigns,
  socialPosts,
  socialGroups = null,
  assets,
  brand,
  timeZone,
}: {
  discounts: any[] | null;
  plans: any[] | null;
  /** null: the campaigns could not be loaded (never shown as "no campaigns"). */
  emailCampaigns: EmailCampaignRow[] | null;
  socialPosts: SocialPostRow[] | null;
  /** Posts made from jobs (social post generator); null when they could not be loaded. */
  socialGroups?: SocialGroupRow[] | null;
  assets: LibraryAssetRow[] | null;
  brand: BrandChrome;
  timeZone: string;
}) {
  const [tab, setTab] = React.useState<MarketingTab>("email");
  const { toast, push } = useEstateToast();
  // A draft made from a template opens in the email editor.
  const [handoffDraft, setHandoffDraft] = React.useState<EmailCampaignRow | null>(null);

  React.useEffect(() => {
    setTab(marketingTabFromParam(new URLSearchParams(window.location.search).get("tab")));
  }, []);

  function choose(next: MarketingTab) {
    setTab(next);
    writeTabParam(next);
  }

  const counts: Partial<Record<MarketingTab, number | null>> = {
    email: emailCampaigns ? emailCampaigns.length : null,
    social: socialPosts ? socialPosts.filter((post) => post.status !== "CANCELLED").length + (socialGroups?.length ?? 0) : null,
  };

  return (
    <div className="space-y-4">
      <div role="tablist" aria-label="Marketing" className="flex gap-1 overflow-x-auto border-b border-[hsl(var(--e-border))] [scrollbar-width:none]">
        {MARKETING_TABS.map((item) => (
          <button
            key={item.key}
            type="button"
            role="tab"
            id={`marketing-tab-${item.key}`}
            aria-selected={tab === item.key}
            aria-controls="marketing-tabpanel"
            onClick={() => choose(item.key)}
            className={`min-h-11 whitespace-nowrap px-3 text-[0.875rem] ${
              tab === item.key ? "border-b-2 border-[hsl(var(--e-primary))] font-[600]" : "text-[hsl(var(--e-muted-foreground))] hover:text-[hsl(var(--e-foreground))]"
            }`}
          >
            {item.label}
            {typeof counts[item.key] === "number" ? <span className="ml-1.5 e-tnum">{counts[item.key]}</span> : null}
          </button>
        ))}
      </div>

      <div id="marketing-tabpanel" role="tabpanel" aria-labelledby={`marketing-tab-${tab}`} className="min-w-0">
        {tab === "email" ? (
          emailCampaigns ? (
            <EmailCampaignsManager
              initialCampaigns={emailCampaigns}
              onToast={push}
              assets={assets ?? []}
              brand={brand}
              timeZone={timeZone}
              externalDraft={handoffDraft}
              onExternalDraftConsumed={() => setHandoffDraft(null)}
              onOpenTemplates={() => choose("templates")}
            />
          ) : (
            <LoadFailed what="Campaigns" />
          )
        ) : null}
        {tab === "offers" ? (
          discounts && plans ? (
            <MarketingCampaignsManager initialCampaigns={discounts} initialPlans={plans} onToast={push} timeZone={timeZone} />
          ) : (
            <LoadFailed what="Discount codes and plans" />
          )
        ) : null}
        {tab === "social" ? socialPosts ? <SocialTab initialPosts={socialPosts} initialGroups={socialGroups} onToast={push} timeZone={timeZone} /> : <LoadFailed what="Social posts" /> : null}
        {tab === "templates" ? (
          <TemplateGallery
            brand={brand}
            onToast={push}
            onUsed={(campaign) => {
              setHandoffDraft(campaign);
              choose("email");
            }}
          />
        ) : null}
        {tab === "images" ? assets ? <AssetLibrary initialAssets={assets} onToast={push} timeZone={timeZone} /> : <LoadFailed what="Images" /> : null}
      </div>

      <EToastViewport toast={toast} />
    </div>
  );
}
