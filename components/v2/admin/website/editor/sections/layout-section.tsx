"use client";

import type { WebsiteContent } from "@/lib/public-site/content";
import type { SectionProps } from "../types";
import { ESectionCard, EField, EInput, ETextarea } from "../shared";
import { EToggle, ESelectNative } from "@/components/v2/admin/settings/estate-form";

const PAGE_KEYS: Array<{ key: keyof WebsiteContent["pageVisibility"]; label: string }> = [
  { key: "home", label: "Home" },
  { key: "services", label: "Services" },
  { key: "whyUs", label: "Why Us" },
  { key: "airbnbHosting", label: "Airbnb Hosting" },
  { key: "subscriptions", label: "Subscriptions" },
  { key: "compareServices", label: "Compare Services" },
  { key: "blog", label: "Blog" },
  { key: "careers", label: "Careers" },
  { key: "faq", label: "FAQ" },
  { key: "contact", label: "Contact" },
  { key: "quote", label: "Instant Quote" },
  { key: "terms", label: "Terms" },
  { key: "privacy", label: "Privacy" },
];

const WIDTH_PRESETS = ["80%", "1080px", "1160px", "1240px", "1320px", "1400px", "1480px"];
const BG_STYLES: WebsiteContent["announcementBar"]["bgStyle"][] = ["subtle", "accent", "dark", "warning"];
const AB_TOGGLES: Array<{ key: "showPhone" | "showLocation" | "showHours" | "showEmail"; label: string }> = [
  { key: "showPhone", label: "Show phone" },
  { key: "showLocation", label: "Show location" },
  { key: "showHours", label: "Show hours" },
  { key: "showEmail", label: "Show email" },
];

export function LayoutSection({ content, setContent, readOnly }: SectionProps) {
  const setVisibility = (key: keyof WebsiteContent["pageVisibility"], value: boolean) =>
    setContent((c) => ({ ...c, pageVisibility: { ...c.pageVisibility, [key]: value } }));
  const setMaint = (p: Partial<WebsiteContent["maintenanceMode"]>) =>
    setContent((c) => ({ ...c, maintenanceMode: { ...c.maintenanceMode, ...p } }));
  const setAb = (p: Partial<WebsiteContent["announcementBar"]>) =>
    setContent((c) => ({ ...c, announcementBar: { ...c.announcementBar, ...p } }));

  const maint = content.maintenanceMode;
  const ab = content.announcementBar;

  return (
    <div className="space-y-5">
      <ESectionCard
        title="Page visibility"
        description="Hidden pages disappear from navigation and return not-found on the public site."
      >
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {PAGE_KEYS.map((item) => (
            <EToggle
              key={item.key}
              label={item.label}
              disabled={readOnly}
              checked={content.pageVisibility[item.key] !== false}
              onChange={(v) => setVisibility(item.key, v)}
            />
          ))}
        </div>
      </ESectionCard>

      <ESectionCard title="Maintenance mode" description="Pause the public website while optionally keeping portal login available.">
        <div className="grid gap-4 md:grid-cols-2">
          <EToggle
            label="Enable maintenance mode"
            description="Replace the public site with a maintenance notice."
            disabled={readOnly}
            checked={maint.enabled}
            onChange={(v) => setMaint({ enabled: v })}
          />
          <EToggle
            label="Allow login while in maintenance"
            description="Admin and portal users can still access /login."
            disabled={readOnly}
            checked={maint.allowLogin}
            onChange={(v) => setMaint({ allowLogin: v })}
          />
        </div>
        <EField label="Maintenance headline">
          <EInput value={maint.message} disabled={readOnly} onChange={(e) => setMaint({ message: e.target.value })} />
        </EField>
        <EField label="Support message">
          <ETextarea rows={3} value={maint.supportMessage} disabled={readOnly} onChange={(e) => setMaint({ supportMessage: e.target.value })} />
        </EField>
      </ESectionCard>

      <ESectionCard
        title="Page container width"
        description="Max width of the centered content area on all public pages. Use a percentage (80%) or pixel value (1200px)."
      >
        <EField label="Container max-width">
          <div className="flex flex-wrap items-center gap-3">
            <EInput
              className="max-w-[200px]"
              value={content.containerWidth ?? "80%"}
              disabled={readOnly}
              placeholder="80%"
              onChange={(e) => setContent((c) => ({ ...c, containerWidth: e.target.value }))}
            />
            <div className="flex flex-wrap gap-2">
              {WIDTH_PRESETS.map((preset) => {
                const active = (content.containerWidth ?? "80%") === preset;
                return (
                  <button
                    key={preset}
                    type="button"
                    disabled={readOnly}
                    onClick={() => setContent((c) => ({ ...c, containerWidth: preset }))}
                    className={
                      "rounded-[var(--e-radius-pill)] border px-3 py-1 text-[0.75rem] font-medium transition-colors disabled:opacity-50 " +
                      (active
                        ? "border-[hsl(var(--e-primary))] bg-[hsl(var(--e-primary))] text-[hsl(var(--e-primary-foreground))]"
                        : "border-[hsl(var(--e-border-strong))] bg-[hsl(var(--e-surface))] text-[hsl(var(--e-muted-foreground))] hover:border-[hsl(var(--e-gold))] hover:text-[hsl(var(--e-gold-ink))]")
                    }
                  >
                    {preset}
                  </button>
                );
              })}
            </div>
          </div>
        </EField>
      </ESectionCard>

      <ESectionCard
        title="Announcement bar"
        description="The thin strip above the public header. Add a promo message or keep it empty to show just the contact row."
      >
        <div className="grid gap-4 md:grid-cols-2">
          <EToggle
            label="Enable announcement bar"
            description="Hide the whole strip from the public site."
            disabled={readOnly}
            checked={ab.enabled}
            onChange={(v) => setAb({ enabled: v })}
          />
          <EField label="Background style">
            <ESelectNative
              value={ab.bgStyle}
              disabled={readOnly}
              onChange={(e) => setAb({ bgStyle: e.target.value as WebsiteContent["announcementBar"]["bgStyle"] })}
            >
              {BG_STYLES.map((s) => (
                <option key={s} value={s}>
                  {s.charAt(0).toUpperCase() + s.slice(1)}
                </option>
              ))}
            </ESelectNative>
          </EField>
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          <EField label="Promo message">
            <EInput value={ab.promoMessage} disabled={readOnly} placeholder="10% off first clean this month" onChange={(e) => setAb({ promoMessage: e.target.value })} />
          </EField>
          <EField label="Promo link">
            <EInput value={ab.promoLink} disabled={readOnly} placeholder="https://…" onChange={(e) => setAb({ promoLink: e.target.value })} />
          </EField>
        </div>
        <EField label="Promo link label">
          <EInput value={ab.promoLinkLabel} disabled={readOnly} placeholder="Book now →" onChange={(e) => setAb({ promoLinkLabel: e.target.value })} />
        </EField>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {AB_TOGGLES.map((item) => (
            <EToggle
              key={item.key}
              label={item.label}
              disabled={readOnly}
              checked={Boolean(ab[item.key])}
              onChange={(v) => setAb({ [item.key]: v })}
            />
          ))}
        </div>
      </ESectionCard>
    </div>
  );
}
