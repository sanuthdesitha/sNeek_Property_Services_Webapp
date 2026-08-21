"use client";

/**
 * Block-based email composer.
 *
 * Persistence note: there is NO new column for blocks. lib/templates/email-blocks.ts
 * renders the design to email-safe HTML and embeds the design JSON as an HTML
 * comment (`<!--SNEEK_EMAIL_DESIGN:{…}-->`) at the top of that HTML, and
 * parseEmailHtml() recovers it. So the block document round-trips inside the
 * existing `EmailCampaign.htmlBody` Text column, and every send path keeps using
 * htmlBody verbatim — no migration, no dual source of truth.
 */

import { useMemo, useState } from "react";
import { ArrowDown, ArrowUp, Trash2, Plus } from "lucide-react";
import {
  EMAIL_BLOCK_TYPES,
  makeBlock,
  renderEmailHtml,
  type EmailBlock,
  type EmailDesign,
} from "@/lib/templates/email-blocks";
import { wrapEmailHtml } from "@/lib/email-templates";
import { TEMPLATE_VARIABLE_TOKENS } from "@/lib/marketing/campaign-templates";
import { EButton, ECard, ECardBody, ECardHeader, ECardTitle } from "@/components/v2/ui/primitives";
import { EConfirmButton, EField, EInput, ESelect, ETextarea } from "@/components/v2/admin/estate-kit";

export type BrandChrome = { companyName: string; logoUrl: string };

export type PickableAsset = { id: string; name: string; url: string; mediaType: string };

/** Full branded HTML exactly as a recipient would see it. */
export function renderCampaignPreview(design: EmailDesign, brand: BrandChrome): string {
  return wrapEmailHtml(brand, renderEmailHtml(design), null);
}

function move<T>(list: T[], from: number, to: number): T[] {
  if (to < 0 || to >= list.length) return list;
  const next = [...list];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}

const ALIGNS = ["left", "center", "right"] as const;

function BlockFields({
  block,
  assets,
  onChange,
}: {
  block: EmailBlock;
  assets: PickableAsset[];
  onChange: (next: EmailBlock) => void;
}) {
  const patch = (data: Partial<EmailBlock>) => onChange({ ...block, ...data } as EmailBlock);

  switch (block.type) {
    case "heading":
    case "text":
      return (
        <div className="space-y-3">
          <EField label={block.type === "heading" ? "Heading text" : "Paragraph"}>
            <ETextarea
              rows={block.type === "heading" ? 2 : 6}
              value={block.text}
              onChange={(e) => patch({ text: e.target.value } as any)}
            />
          </EField>
          <div className="grid gap-3 sm:grid-cols-3">
            <EField label="Align">
              <ESelect value={block.align} onChange={(e) => patch({ align: e.target.value as any } as any)}>
                {ALIGNS.map((a) => <option key={a} value={a}>{a}</option>)}
              </ESelect>
            </EField>
            <EField label="Colour">
              <EInput type="color" value={block.color} onChange={(e) => patch({ color: e.target.value } as any)} />
            </EField>
            <EField label="Size (px)">
              <EInput
                type="number"
                min="10"
                max="48"
                value={block.fontSize}
                onChange={(e) => patch({ fontSize: Number(e.target.value) || 15 } as any)}
              />
            </EField>
          </div>
        </div>
      );
    case "button":
      return (
        <div className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <EField label="Label"><EInput value={block.text} onChange={(e) => patch({ text: e.target.value } as any)} /></EField>
            <EField label="Link"><EInput value={block.href} onChange={(e) => patch({ href: e.target.value } as any)} placeholder="/quote" /></EField>
          </div>
          <div className="grid gap-3 sm:grid-cols-4">
            <EField label="Align">
              <ESelect value={block.align} onChange={(e) => patch({ align: e.target.value as any } as any)}>
                {ALIGNS.map((a) => <option key={a} value={a}>{a}</option>)}
              </ESelect>
            </EField>
            <EField label="Background"><EInput type="color" value={block.bg} onChange={(e) => patch({ bg: e.target.value } as any)} /></EField>
            <EField label="Text"><EInput type="color" value={block.color} onChange={(e) => patch({ color: e.target.value } as any)} /></EField>
            <EField label="Radius"><EInput type="number" min="0" max="40" value={block.radius} onChange={(e) => patch({ radius: Number(e.target.value) || 0 } as any)} /></EField>
          </div>
        </div>
      );
    case "image":
      return (
        <div className="space-y-3">
          <EField label="Pick from asset library">
            <ESelect
              value=""
              onChange={(e) => {
                const asset = assets.find((a) => a.id === e.target.value);
                if (asset) patch({ src: asset.url, alt: asset.name } as any);
              }}
            >
              <option value="">Choose an asset…</option>
              {assets.filter((a) => a.mediaType === "IMAGE" || a.mediaType === "GIF").map((a) => (
                <option key={a.id} value={a.id}>{a.name}</option>
              ))}
            </ESelect>
          </EField>
          <EField label="Image URL"><EInput value={block.src} onChange={(e) => patch({ src: e.target.value } as any)} placeholder="https://…" /></EField>
          <div className="grid gap-3 sm:grid-cols-2">
            <EField label="Alt text"><EInput value={block.alt} onChange={(e) => patch({ alt: e.target.value } as any)} /></EField>
            <EField label="Links to (optional)"><EInput value={block.href ?? ""} onChange={(e) => patch({ href: e.target.value || undefined } as any)} /></EField>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <EField label="Width (px)"><EInput type="number" min="40" max="600" value={block.width} onChange={(e) => patch({ width: Number(e.target.value) || 240 } as any)} /></EField>
            <EField label="Align">
              <ESelect value={block.align} onChange={(e) => patch({ align: e.target.value as any } as any)}>
                {ALIGNS.map((a) => <option key={a} value={a}>{a}</option>)}
              </ESelect>
            </EField>
          </div>
          {block.src ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={block.src} alt={block.alt} className="max-h-28 rounded-[var(--e-radius-sm)] border border-[hsl(var(--e-border))] object-contain" />
          ) : null}
        </div>
      );
    case "divider":
      return (
        <EField label="Line colour">
          <EInput type="color" value={block.color} onChange={(e) => patch({ color: e.target.value } as any)} />
        </EField>
      );
    case "spacer":
      return (
        <EField label="Height (px)">
          <EInput type="number" min="4" max="120" value={block.height} onChange={(e) => patch({ height: Number(e.target.value) || 24 } as any)} />
        </EField>
      );
  }
}

export function EmailBlockEditor({
  design,
  onChange,
  assets,
  brand,
}: {
  design: EmailDesign;
  onChange: (next: EmailDesign) => void;
  assets: PickableAsset[];
  brand: BrandChrome;
}) {
  const [openId, setOpenId] = useState<string | null>(design.blocks[0]?.id ?? null);

  const setBlocks = (blocks: EmailBlock[]) => onChange({ ...design, blocks });

  function addBlock(type: EmailBlock["type"]) {
    const block = makeBlock(type);
    setBlocks([...design.blocks, block]);
    setOpenId(block.id);
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-1.5">
        {EMAIL_BLOCK_TYPES.map((t) => (
          <EButton key={t.type} type="button" variant="outline" size="sm" onClick={() => addBlock(t.type)}>
            <Plus className="h-3.5 w-3.5" />{t.label}
          </EButton>
        ))}
      </div>

      <div className="space-y-2">
        {design.blocks.length === 0 ? (
          <p className="rounded-[var(--e-radius)] border border-dashed border-[hsl(var(--e-border))] p-4 text-center text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">
            No blocks yet — add a heading or some text to get started.
          </p>
        ) : null}
        {design.blocks.map((block, index) => {
          const open = openId === block.id;
          const label = "text" in block ? block.text.slice(0, 60) : block.type;
          return (
            <div key={block.id} className="rounded-[var(--e-radius)] border border-[hsl(var(--e-border))]">
              <div className="flex items-center gap-2 p-2">
                <button
                  type="button"
                  onClick={() => setOpenId(open ? null : block.id)}
                  className="min-w-0 flex-1 text-left"
                >
                  <span className="text-[0.6875rem] uppercase tracking-[0.08em] text-[hsl(var(--e-muted-foreground))]">{block.type}</span>
                  <span className="ml-2 truncate text-[0.8125rem] text-[hsl(var(--e-foreground))]">{label}</span>
                </button>
                <button type="button" aria-label="Move up" disabled={index === 0} onClick={() => setBlocks(move(design.blocks, index, index - 1))} className="rounded p-1 text-[hsl(var(--e-muted-foreground))] hover:text-[hsl(var(--e-foreground))] disabled:opacity-30">
                  <ArrowUp className="h-4 w-4" />
                </button>
                <button type="button" aria-label="Move down" disabled={index === design.blocks.length - 1} onClick={() => setBlocks(move(design.blocks, index, index + 1))} className="rounded p-1 text-[hsl(var(--e-muted-foreground))] hover:text-[hsl(var(--e-foreground))] disabled:opacity-30">
                  <ArrowDown className="h-4 w-4" />
                </button>
                {/* Low tier: one block of an unsaved email design. */}
                <EConfirmButton
                  ariaLabel="Remove block"
                  confirmLabel={<span className="px-0.5 text-[0.6875rem] font-[600]">Sure?</span>}
                  onConfirm={() => setBlocks(design.blocks.filter((b) => b.id !== block.id))}
                  className="rounded p-1 text-[hsl(var(--e-danger,0_70%_45%))] hover:opacity-80"
                >
                  <Trash2 className="h-4 w-4" />
                </EConfirmButton>
              </div>
              {open ? (
                <div className="border-t border-[hsl(var(--e-border))] p-3">
                  <BlockFields
                    block={block}
                    assets={assets}
                    onChange={(next) => setBlocks(design.blocks.map((b) => (b.id === block.id ? next : b)))}
                  />
                </div>
              ) : null}
            </div>
          );
        })}
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <EField label="Page background"><EInput type="color" value={design.pageBackground} onChange={(e) => onChange({ ...design, pageBackground: e.target.value })} /></EField>
        <EField label="Card background"><EInput type="color" value={design.cardBackground} onChange={(e) => onChange({ ...design, cardBackground: e.target.value })} /></EField>
      </div>

      <div className="rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface-raised))] p-3">
        <p className="mb-1.5 text-[0.6875rem] font-[550] uppercase tracking-[0.08em] text-[hsl(var(--e-muted-foreground))]">Variables</p>
        <p className="mb-2 text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
          Paste any of these into a heading, paragraph or button — they resolve per recipient at send time.
        </p>
        <div className="flex flex-wrap gap-1.5">
          {TEMPLATE_VARIABLE_TOKENS.map((token) => (
            <code key={token} className="rounded bg-[hsl(var(--e-muted))] px-1.5 py-0.5 text-[0.75rem] text-[hsl(var(--e-foreground))]">
              {`{{${token}}}`}
            </code>
          ))}
        </div>
      </div>
    </div>
  );
}

export function EmailPreview({
  design,
  brand,
  height = 620,
  title = "Live preview",
}: {
  design: EmailDesign;
  brand: BrandChrome;
  height?: number;
  title?: string;
}) {
  const html = useMemo(() => renderCampaignPreview(design, brand), [design, brand]);
  return (
    <ECard>
      <ECardHeader className="pb-2"><ECardTitle className="text-[0.95rem]">{title}</ECardTitle></ECardHeader>
      <ECardBody className="pt-0">
        <iframe
          title={title}
          srcDoc={html}
          sandbox=""
          className="w-full rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] bg-white"
          style={{ height }}
        />
      </ECardBody>
    </ECard>
  );
}
