"use client";

import { useState } from "react";
import { Image as ImageIcon, LayoutTemplate, Megaphone, Send, Share2 } from "lucide-react";
import { MarketingCampaignsManager } from "@/components/v2/admin/marketing/campaigns-manager";
import {
  EmailCampaignsManager,
  type CampaignStatsRow,
} from "@/components/v2/admin/marketing/email-campaigns-manager";
import { TemplateGallery } from "@/components/v2/admin/marketing/template-gallery";
import { SocialManager } from "@/components/v2/admin/marketing/social-manager";
import { AssetLibrary } from "@/components/v2/admin/marketing/asset-library";
import { useEstateToast, EToastViewport } from "@/components/v2/admin/marketing/toast";
import type { BrandChrome } from "@/components/v2/admin/marketing/email-block-editor";

type Section = "campaigns" | "templates" | "email" | "social" | "assets";

const SECTIONS: Array<{ key: Section; label: string; icon: React.ComponentType<{ className?: string }> }> = [
  { key: "campaigns", label: "Campaigns & plans", icon: Megaphone },
  { key: "templates", label: "Templates", icon: LayoutTemplate },
  { key: "email", label: "Email campaigns", icon: Send },
  { key: "social", label: "Social posts", icon: Share2 },
  { key: "assets", label: "Asset library", icon: ImageIcon },
];

export function MarketingHub({
  campaigns,
  plans,
  emailCampaigns,
  socialPosts,
  assets,
  brand,
  emailStats = {},
}: {
  campaigns: any[];
  plans: any[];
  emailCampaigns: any[];
  socialPosts: any[];
  assets: any[];
  brand: BrandChrome;
  emailStats?: Record<string, CampaignStatsRow>;
}) {
  const [section, setSection] = useState<Section>("campaigns");
  const { toast, push } = useEstateToast();
  // Draft handed over from the template gallery → opened in the email manager.
  const [handoffDraft, setHandoffDraft] = useState<any | null>(null);

  return (
    <div className="space-y-6">
      <div className="-mx-1 overflow-x-auto px-1 pb-1">
        <div className="inline-flex min-w-full items-center gap-1 rounded-[var(--e-radius-lg)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface-raised))] p-1">
          {SECTIONS.map((s) => {
            const Icon = s.icon;
            const active = section === s.key;
            return (
              <button
                key={s.key}
                type="button"
                onClick={() => setSection(s.key)}
                aria-current={active ? "page" : undefined}
                className={`inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-[var(--e-radius)] px-3 py-1.5 text-[0.8125rem] font-[550] tracking-[0.01em] transition-colors ${
                  active
                    ? "bg-[hsl(var(--e-surface))] text-[hsl(var(--e-foreground))] shadow-[var(--e-elevation-1)]"
                    : "text-[hsl(var(--e-muted-foreground))] hover:text-[hsl(var(--e-foreground))]"
                }`}
              >
                <Icon className="h-3.5 w-3.5" />
                {s.label}
              </button>
            );
          })}
        </div>
      </div>

      {section === "campaigns" ? (
        <MarketingCampaignsManager initialCampaigns={campaigns} initialPlans={plans} onToast={push} />
      ) : null}
      {section === "templates" ? (
        <TemplateGallery
          brand={brand}
          onToast={push}
          onUsed={(campaign) => {
            setHandoffDraft(campaign);
            setSection("email");
          }}
        />
      ) : null}
      {/* Kept mounted-on-demand: the email manager owns its own campaign list state. */}
      {section === "email" ? (
        <EmailCampaignsManager
          initialCampaigns={emailCampaigns}
          onToast={push}
          assets={assets}
          brand={brand}
          stats={emailStats}
          externalDraft={handoffDraft}
          onExternalDraftConsumed={() => setHandoffDraft(null)}
        />
      ) : null}
      {section === "social" ? <SocialManager initialPosts={socialPosts} onToast={push} /> : null}
      {section === "assets" ? <AssetLibrary initialAssets={assets} onToast={push} /> : null}

      <EToastViewport toast={toast} />
    </div>
  );
}
