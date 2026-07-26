"use client";

/**
 * Ready-to-send template gallery. Each card previews the real rendered email
 * (block renderer + branded wrap) and "Use template" creates a DRAFT
 * EmailCampaign prefilled from it, then hands off to the email campaigns
 * manager with that campaign already open for editing.
 */

import { useMemo, useState } from "react";
import { Eye, Wand2 } from "lucide-react";
import {
  CAMPAIGN_TEMPLATES,
  TEMPLATE_CATEGORY_META,
  templateToDesign,
  type CampaignTemplate,
  type TemplateCategory,
} from "@/lib/marketing/campaign-templates";
import { renderEmailHtml } from "@/lib/templates/email-blocks";
import {
  EmailPreview,
  renderCampaignPreview,
  type BrandChrome,
} from "@/components/v2/admin/marketing/email-block-editor";
import { EBadge, EButton, ECard, ECardBody, ECardHeader, ECardTitle } from "@/components/v2/ui/primitives";
import { EModal } from "@/components/v2/admin/estate-kit";

type Toast = { title: string; description?: string; tone: "success" | "danger" };

const CATEGORY_ORDER: TemplateCategory[] = [
  "seasonal",
  "lifecycle",
  "promotion",
  "announcement",
  "trust",
  "newsletter",
];

function channelTone(channel: CampaignTemplate["channel"]): "info" | "warning" | "neutral" {
  if (channel === "EMAIL") return "info";
  if (channel === "SMS") return "warning";
  return "neutral";
}

export function TemplateGallery({
  brand,
  onToast,
  onUsed,
}: {
  brand: BrandChrome;
  onToast: (t: Toast) => void;
  /** Called with the newly created draft campaign so the hub can open it. */
  onUsed: (campaign: any) => void;
}) {
  const [category, setCategory] = useState<TemplateCategory | "all">("all");
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [usingId, setUsingId] = useState<string | null>(null);

  const visible = useMemo(
    () => (category === "all" ? CAMPAIGN_TEMPLATES : CAMPAIGN_TEMPLATES.filter((t) => t.category === category)),
    [category],
  );

  const previewTemplate = previewId ? CAMPAIGN_TEMPLATES.find((t) => t.id === previewId) ?? null : null;

  async function useTemplate(template: CampaignTemplate) {
    setUsingId(template.id);
    try {
      const design = templateToDesign(template);
      const res = await fetch("/api/admin/email-campaigns", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: template.name,
          subject: template.subject,
          // renderEmailHtml embeds the block design as an HTML comment, so the
          // new draft opens straight back into the block composer.
          htmlBody: renderEmailHtml(design),
          audience: { type: "segment", filters: { segmentId: template.suggestedAudience } },
          status: "draft",
          scheduledAt: null,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? "Could not create the draft.");
      onToast({ title: "Draft created", description: `${template.name} is ready to edit.`, tone: "success" });
      onUsed(body.campaign);
    } catch (error: any) {
      onToast({ title: "Could not use template", description: error?.message, tone: "danger" });
    } finally {
      setUsingId(null);
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-1.5">
        <button
          type="button"
          onClick={() => setCategory("all")}
          className={`rounded-[var(--e-radius)] px-2.5 py-1 text-[0.8125rem] font-[550] transition-colors ${
            category === "all"
              ? "bg-[hsl(var(--e-primary))] text-[hsl(var(--e-primary-foreground))]"
              : "border border-[hsl(var(--e-border))] text-[hsl(var(--e-muted-foreground))] hover:text-[hsl(var(--e-foreground))]"
          }`}
        >
          All ({CAMPAIGN_TEMPLATES.length})
        </button>
        {CATEGORY_ORDER.map((key) => {
          const count = CAMPAIGN_TEMPLATES.filter((t) => t.category === key).length;
          if (count === 0) return null;
          const active = category === key;
          return (
            <button
              key={key}
              type="button"
              onClick={() => setCategory(key)}
              title={TEMPLATE_CATEGORY_META[key].description}
              className={`rounded-[var(--e-radius)] px-2.5 py-1 text-[0.8125rem] font-[550] transition-colors ${
                active
                  ? "bg-[hsl(var(--e-primary))] text-[hsl(var(--e-primary-foreground))]"
                  : "border border-[hsl(var(--e-border))] text-[hsl(var(--e-muted-foreground))] hover:text-[hsl(var(--e-foreground))]"
              }`}
            >
              {TEMPLATE_CATEGORY_META[key].label} ({count})
            </button>
          );
        })}
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {visible.map((template) => (
          <ECard key={template.id} className="flex flex-col">
            <ECardHeader className="pb-2">
              <div className="flex items-start justify-between gap-2">
                <ECardTitle className="text-[0.9375rem]">{template.name}</ECardTitle>
                <EBadge tone={channelTone(template.channel)} soft>{template.channel}</EBadge>
              </div>
              <p className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
                {TEMPLATE_CATEGORY_META[template.category].label}
              </p>
            </ECardHeader>
            <ECardBody className="flex flex-1 flex-col gap-3 pt-0">
              <div className="overflow-hidden rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] bg-white">
                <iframe
                  title={`${template.name} preview`}
                  srcDoc={renderCampaignPreview(templateToDesign(template), brand)}
                  sandbox=""
                  scrolling="no"
                  className="pointer-events-none h-[280px] w-[200%] origin-top-left"
                  style={{ transform: "scale(0.5)", marginBottom: -140 }}
                />
              </div>
              <div className="space-y-1">
                <p className="text-[0.8125rem] font-[550] text-[hsl(var(--e-foreground))]">{template.subject}</p>
                <p className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">{template.previewText}</p>
              </div>
              <p className="text-[0.75rem] text-[hsl(var(--e-text-faint))]">Goal: {template.goal}</p>
              <div className="mt-auto flex flex-wrap gap-2 pt-1">
                <EButton variant="outline" size="sm" onClick={() => setPreviewId(template.id)}>
                  <Eye className="h-3.5 w-3.5" />Preview
                </EButton>
                <EButton size="sm" onClick={() => useTemplate(template)} disabled={usingId === template.id}>
                  <Wand2 className="h-3.5 w-3.5" />{usingId === template.id ? "Creating…" : "Use template"}
                </EButton>
              </div>
            </ECardBody>
          </ECard>
        ))}
      </div>

      <EModal
        open={Boolean(previewTemplate)}
        onClose={() => setPreviewId(null)}
        title={previewTemplate?.name ?? "Preview"}
        eyebrow="Template"
      >
        {previewTemplate ? (
          <div className="space-y-4">
            <div className="space-y-1 text-[0.8125rem]">
              <p><span className="text-[hsl(var(--e-muted-foreground))]">Subject: </span>{previewTemplate.subject}</p>
              <p><span className="text-[hsl(var(--e-muted-foreground))]">Preheader: </span>{previewTemplate.previewText}</p>
              <p><span className="text-[hsl(var(--e-muted-foreground))]">Suggested audience: </span>{previewTemplate.suggestedAudience.replace(/_/g, " ")}</p>
              {previewTemplate.variables.length ? (
                <p><span className="text-[hsl(var(--e-muted-foreground))]">Variables: </span>{previewTemplate.variables.map((v) => `{{${v}}}`).join(", ")}</p>
              ) : null}
            </div>
            <EmailPreview design={templateToDesign(previewTemplate)} brand={brand} height={480} title="Rendered email" />
            {previewTemplate.smsBody ? (
              <div className="rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface-raised))] p-3">
                <p className="mb-1 text-[0.6875rem] font-[550] uppercase tracking-[0.08em] text-[hsl(var(--e-muted-foreground))]">SMS version</p>
                <p className="whitespace-pre-wrap text-[0.8125rem] text-[hsl(var(--e-foreground))]">{previewTemplate.smsBody}</p>
              </div>
            ) : null}
            <div className="flex justify-end gap-2">
              <EButton variant="outline" size="sm" onClick={() => setPreviewId(null)}>Close</EButton>
              <EButton size="sm" onClick={() => { const t = previewTemplate; setPreviewId(null); void useTemplate(t); }}>
                Use template
              </EButton>
            </div>
          </div>
        ) : null}
      </EModal>
    </div>
  );
}
