"use client";

/**
 * Estate WEBSITE CMS editor — native Estate rewrite of the v1 public-site
 * content editor. Edits the full `websiteContent` schema and saves through the
 * same `PATCH /api/admin/settings` payload (`{ websiteContent }`). Images use
 * `/api/uploads/direct`. Live preview opens at /v2/admin/website/preview.
 *
 * ZERO imports from @/components/{admin,ui,shared}. Estate primitives only.
 */
import * as React from "react";
import Link from "next/link";
import { Eye, Save, RotateCcw, ExternalLink } from "lucide-react";
import {
  DEFAULT_WEBSITE_CONTENT,
  type WebsiteContent,
} from "@/lib/public-site/content";
import { MARKETED_SERVICES } from "@/lib/marketing/catalog";
import { EButton, EPageHeader, EAlert } from "@/components/v2/ui/primitives";
import { ESaveStatus, useSaveStatus } from "@/components/v2/admin/settings/estate-form";
import { cloneContent } from "./shared";
import { HomeSection } from "./sections/home-section";
import { PagesCopySection } from "./sections/pages-copy-section";
import { ContactSection } from "./sections/contact-section";
import { LegalSection } from "./sections/legal-section";
import { WhyFaqSection } from "./sections/why-faq-section";
import { MediaSection } from "./sections/media-section";
import { ServicePagesSection } from "./sections/service-pages-section";
import { LayoutSection } from "./sections/layout-section";
import { RawJsonSection } from "./sections/raw-json-section";

type TabKey =
  | "home"
  | "pages"
  | "contact"
  | "legal"
  | "trust"
  | "media"
  | "service-pages"
  | "layout"
  | "json";

const TABS: Array<{ key: TabKey; label: string; summary: string }> = [
  { key: "home", label: "Home", summary: "Hero, stats, benefit cards, hosting strip, testimonials & final CTA." },
  { key: "pages", label: "Landing pages", summary: "Services, Airbnb and Subscriptions marketing copy." },
  { key: "contact", label: "Contact & footer", summary: "Public contact details, lead recipients and footer text." },
  { key: "legal", label: "Terms & privacy", summary: "Legal page intros, insurance note and structured sections." },
  { key: "trust", label: "Why us & FAQ", summary: "Trust reasons and public FAQ items." },
  { key: "media", label: "Gallery / partners / social", summary: "Work gallery, partner logos and social links." },
  { key: "service-pages", label: "Service pages", summary: "Per-service detail page content and SEO copy." },
  { key: "layout", label: "Layout & visibility", summary: "Page toggles, maintenance mode, width and announcement bar." },
  { key: "json", label: "Raw JSON", summary: "Advanced full-object editing and restores." },
];

export function WebsiteCmsEditor({
  initialContent,
  companyName = "sNeek Property Services",
  logoUrl = "",
  readOnly,
}: {
  initialContent: WebsiteContent;
  companyName?: string;
  logoUrl?: string;
  readOnly: boolean;
}) {
  const [content, setContent] = React.useState<WebsiteContent>(() => cloneContent(initialContent));
  const [saving, setSaving] = React.useState(false);
  const [uploadingKey, setUploadingKey] = React.useState<string | null>(null);
  const { status, flash } = useSaveStatus();
  const [activeTab, setActiveTab] = React.useState<TabKey>("home");

  const activeMeta = TABS.find((t) => t.key === activeTab) ?? TABS[0]!;

  /* ── Direct image upload (same endpoint/folder as v1) ─────────────────── */
  const uploadImage = React.useCallback(async (file: File): Promise<string> => {
    const form = new FormData();
    form.append("file", file);
    form.append("folder", "website");
    const res = await fetch("/api/uploads/direct", { method: "POST", body: form });
    const body = await res.json().catch(() => ({}));
    if (!res.ok || !body.url) throw new Error(body.error ?? "Could not upload image.");
    return body.url as string;
  }, []);

  const handleUpload = React.useCallback(
    async (key: string, file: File, apply: (url: string) => void) => {
      if (readOnly) return;
      setUploadingKey(key);
      try {
        const url = await uploadImage(file);
        apply(url);
        flash("saved", "Image uploaded — remember to save");
      } catch (e: any) {
        flash("error", e?.message ?? "Could not upload image.");
      } finally {
        setUploadingKey(null);
      }
    },
    [readOnly, uploadImage, flash]
  );

  /* ── Save via PATCH /api/admin/settings ({ websiteContent }) ──────────── */
  const save = React.useCallback(
    async (next: WebsiteContent = content) => {
      if (readOnly) return;
      setSaving(true);
      try {
        const res = await fetch("/api/admin/settings", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ websiteContent: next }),
        });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) {
          flash("error", body.error ?? "Could not save website content.");
          return;
        }
        const saved = (body.websiteContent as WebsiteContent) ?? next;
        setContent(saved);
        flash("saved", "Website updated");
      } catch {
        flash("error", "Could not save website content.");
      } finally {
        setSaving(false);
      }
    },
    [content, readOnly, flash]
  );

  const resetDraft = React.useCallback(() => {
    setContent(cloneContent(initialContent));
    flash("saved", "Draft reset to last saved");
  }, [initialContent, flash]);

  /* ── Section props bundle ─────────────────────────────────────────────── */
  const sectionProps = {
    content,
    setContent,
    readOnly,
    uploadingKey,
    handleUpload,
  };

  return (
    <div className="space-y-6">
      <EPageHeader
        eyebrow="Public website"
        title="Website CMS"
        description="Edit the customer-facing marketing site — copy, images, sections and visibility — then publish."
        actions={
          <>
            <ESaveStatus status={status} />
            <EButton variant="outline" size="sm" asChild>
              <Link href="/v2/admin/website/preview" target="_blank" rel="noreferrer">
                <Eye className="h-3.5 w-3.5" />
                Preview
              </Link>
            </EButton>
            <EButton variant="ghost" size="sm" asChild>
              <a href="/" target="_blank" rel="noreferrer">
                <ExternalLink className="h-3.5 w-3.5" />
                Live site
              </a>
            </EButton>
            {!readOnly ? (
              <>
                <EButton variant="outline" size="sm" onClick={resetDraft} disabled={saving}>
                  <RotateCcw className="h-3.5 w-3.5" />
                  Reset
                </EButton>
                <EButton size="sm" onClick={() => save()} disabled={saving}>
                  <Save className="h-3.5 w-3.5" />
                  {saving ? "Saving…" : "Save website"}
                </EButton>
              </>
            ) : null}
          </>
        }
      />

      {readOnly ? (
        <EAlert tone="info" title="Read-only">
          Administrator access is required to edit and publish website content.
        </EAlert>
      ) : null}

      <TabButtons active={activeTab} onSelect={setActiveTab} />

      <p className="text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">{activeMeta.summary}</p>

      {activeTab === "home" ? <HomeSection {...sectionProps} /> : null}
      {activeTab === "pages" ? <PagesCopySection {...sectionProps} /> : null}
      {activeTab === "contact" ? <ContactSection {...sectionProps} /> : null}
      {activeTab === "legal" ? <LegalSection {...sectionProps} /> : null}
      {activeTab === "trust" ? <WhyFaqSection {...sectionProps} /> : null}
      {activeTab === "media" ? <MediaSection {...sectionProps} /> : null}
      {activeTab === "service-pages" ? (
        <ServicePagesSection {...sectionProps} services={MARKETED_SERVICES} />
      ) : null}
      {activeTab === "layout" ? <LayoutSection {...sectionProps} /> : null}
      {activeTab === "json" ? (
        <RawJsonSection
          content={content}
          setContent={setContent}
          readOnly={readOnly}
          onSave={save}
          saving={saving}
          defaults={DEFAULT_WEBSITE_CONTENT}
        />
      ) : null}

      {/* Sticky footer save bar */}
      {!readOnly ? (
        <div className="sticky bottom-4 z-20 flex justify-end">
          <div className="flex items-center gap-3 rounded-[var(--e-radius-lg)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface))] px-4 py-3 shadow-[var(--e-elevation-2)]">
            <span className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
              Editing <span className="font-medium text-[hsl(var(--e-foreground))]">{activeMeta.label}</span>
            </span>
            <ESaveStatus status={status} />
            <EButton variant="outline" size="sm" onClick={resetDraft} disabled={saving}>
              <RotateCcw className="h-3.5 w-3.5" />
              Reset
            </EButton>
            <EButton size="sm" onClick={() => save()} disabled={saving}>
              <Save className="h-3.5 w-3.5" />
              {saving ? "Saving…" : "Save website"}
            </EButton>
          </div>
        </div>
      ) : null}
    </div>
  );
}

/**
 * Interactive Estate chip-tab selector rendered as buttons so the editor stays
 * a single client page without route churn (mirrors EChipTabs styling).
 */
function TabButtons({
  active,
  onSelect,
}: {
  active: TabKey;
  onSelect: (key: TabKey) => void;
}) {
  return (
    <div className="-mx-1 overflow-x-auto px-1 pb-1">
      <div className="inline-flex min-w-full items-center gap-1 rounded-[var(--e-radius-lg)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface-raised))] p-1">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => onSelect(t.key)}
            aria-current={t.key === active ? "page" : undefined}
            className={
              "inline-flex shrink-0 items-center whitespace-nowrap rounded-[var(--e-radius)] px-3 py-1.5 text-[0.8125rem] font-[550] tracking-[0.01em] transition-colors duration-[160ms] " +
              (t.key === active
                ? "bg-[hsl(var(--e-surface))] text-[hsl(var(--e-foreground))] shadow-[var(--e-elevation-1)]"
                : "text-[hsl(var(--e-muted-foreground))] hover:bg-[hsl(var(--e-surface))] hover:text-[hsl(var(--e-foreground))]")
            }
          >
            {t.label}
          </button>
        ))}
      </div>
    </div>
  );
}
