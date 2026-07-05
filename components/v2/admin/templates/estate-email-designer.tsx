"use client";

/**
 * Estate-native email body designer.
 *
 * Reuses the shared, non-UI block model + renderer from `@/lib/templates/email-blocks`
 * (the same document format v1 reads/writes, so HTML round-trips cleanly through the
 * `PATCH /api/admin/notifications/templates` endpoint) but paints an entirely new
 * Estate UI on top — zero imports from components/{ui,admin,shared}.
 *
 * The rich HTML body is edited as a vertical STACK OF BLOCKS (heading / text / button /
 * image / divider / spacer): the reliable, email-safe shape. Each block has an Estate
 * inspector; text-bearing blocks get a variable-chip inserter. A live iframe renders the
 * email-safe HTML with sample merge data so you see the real output.
 */

import * as React from "react";
import {
  ArrowDown,
  ArrowUp,
  Heading,
  Image as ImageIcon,
  Minus,
  MousePointerClick,
  Plus,
  StretchVertical,
  Trash2,
  Type,
} from "lucide-react";
import {
  EMAIL_BLOCK_TYPES,
  makeBlock,
  renderEmailHtml,
  type EmailBlock,
  type EmailBlockAlign,
  type EmailDesign,
} from "@/lib/templates/email-blocks";
import { EField, EInput, ETextarea } from "@/components/v2/admin/estate-kit";

const TYPE_ICON: Record<EmailBlock["type"], typeof Type> = {
  heading: Heading,
  text: Type,
  button: MousePointerClick,
  image: ImageIcon,
  divider: Minus,
  spacer: StretchVertical,
};

/** Replace {{var}} tokens with readable sample data for the preview iframe. */
function fillSample(html: string, variables: string[]): string {
  let out = html;
  for (const v of variables) {
    const sample = SAMPLE_VALUES[v] ?? `[${v}]`;
    out = out.split(`{{${v}}}`).join(sample);
  }
  // Any leftover unknown tokens → keep visible but neutral.
  return out.replace(/\{\{\s*([\w.]+)\s*\}\}/g, "[$1]");
}

const SAMPLE_VALUES: Record<string, string> = {
  recipientName: "Alex Morgan",
  clientName: "Harborview Estates",
  clientEmail: "alex@harborview.com",
  cleanerName: "Jordan Lee",
  invoiceNumber: "INV-10428",
  totalAmount: "$1,240.00",
  amount: "$620.00",
  requestedAmount: "$85.00",
  approvedAmount: "$85.00",
  refundAmount: "$120.00",
  grandTotal: "$8,940.00",
  actionUrl: "https://app.sneek.com/portal",
  paymentLink: "https://pay.sneek.com/inv-10428",
  dueDate: "12 Aug 2026",
  paidAt: "6 Jul 2026, 2:14pm",
  periodStart: "1 Jul 2026",
  periodEnd: "31 Jul 2026",
  jobType: "End of lease",
  next_clean_date: "14 Jul 2026",
  property_address: "42 Marina Parade",
  feedback_url: "https://app.sneek.com/review/abc",
};

const swatchBtn =
  "h-9 w-11 shrink-0 cursor-pointer rounded-[var(--e-radius)] border border-[hsl(var(--e-input))] bg-[hsl(var(--e-surface))] p-1";

export function EstateEmailDesigner({
  design,
  onChange,
  variables,
}: {
  design: EmailDesign;
  onChange: (next: EmailDesign) => void;
  variables: string[];
}) {
  const [selectedId, setSelectedId] = React.useState<string | null>(
    design.blocks[0]?.id ?? null
  );
  const selected = design.blocks.find((b) => b.id === selectedId) ?? null;
  const previewHtml = React.useMemo(
    () => fillSample(renderEmailHtml(design), variables),
    [design, variables]
  );

  function update(next: Partial<EmailDesign>) {
    onChange({ ...design, ...next });
  }
  function updateBlock(id: string, patch: Partial<EmailBlock>) {
    update({
      blocks: design.blocks.map((b) =>
        b.id === id ? ({ ...b, ...patch } as EmailBlock) : b
      ),
    });
  }
  function addBlock(type: EmailBlock["type"]) {
    const block = makeBlock(type);
    update({ blocks: [...design.blocks, block] });
    setSelectedId(block.id);
  }
  function removeBlock(id: string) {
    update({ blocks: design.blocks.filter((b) => b.id !== id) });
    if (selectedId === id) setSelectedId(null);
  }
  function move(id: string, dir: -1 | 1) {
    const idx = design.blocks.findIndex((b) => b.id === id);
    const swap = idx + dir;
    if (idx < 0 || swap < 0 || swap >= design.blocks.length) return;
    const blocks = [...design.blocks];
    [blocks[idx], blocks[swap]] = [blocks[swap], blocks[idx]];
    update({ blocks });
  }
  function insertVar(v: string) {
    if (!selected || !("text" in selected)) return;
    updateBlock(selected.id, {
      text: `${(selected as any).text}{{${v}}}`,
    } as Partial<EmailBlock>);
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[210px_1fr_260px]">
      {/* Palette + layers */}
      <div className="space-y-4">
        <div>
          <p className="mb-2 text-[0.6875rem] font-semibold uppercase tracking-[0.14em] text-[hsl(var(--e-gold-ink))]">
            Add block
          </p>
          <div className="grid grid-cols-3 gap-1.5">
            {EMAIL_BLOCK_TYPES.map(({ type, label }) => {
              const Icon = TYPE_ICON[type];
              return (
                <button
                  key={type}
                  type="button"
                  onClick={() => addBlock(type)}
                  title={label}
                  className="flex flex-col items-center gap-1 rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface))] p-2 text-[0.6875rem] text-[hsl(var(--e-text-secondary))] transition-colors hover:border-[hsl(var(--e-gold)/0.5)] hover:text-[hsl(var(--e-foreground))]"
                >
                  <Icon className="h-4 w-4" />
                  {label}
                </button>
              );
            })}
          </div>
        </div>

        <div>
          <p className="mb-2 text-[0.6875rem] font-semibold uppercase tracking-[0.14em] text-[hsl(var(--e-gold-ink))]">
            Layers
          </p>
          <div className="space-y-1">
            {design.blocks.map((b) => {
              const Icon = TYPE_ICON[b.type];
              const active = b.id === selectedId;
              return (
                <div
                  key={b.id}
                  className={`flex items-center gap-1.5 rounded-[var(--e-radius)] border px-2 py-1.5 text-[0.75rem] ${
                    active
                      ? "border-[hsl(var(--e-primary))] bg-[hsl(var(--e-primary)/0.06)]"
                      : "border-[hsl(var(--e-border))]"
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => setSelectedId(b.id)}
                    className="flex flex-1 items-center gap-1.5 overflow-hidden text-left text-[hsl(var(--e-foreground))]"
                  >
                    <Icon className="h-3.5 w-3.5 shrink-0" />
                    <span className="truncate capitalize">
                      {"text" in b && b.text ? b.text : b.type}
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={() => move(b.id, -1)}
                    className="text-[hsl(var(--e-muted-foreground))] hover:text-[hsl(var(--e-foreground))]"
                    aria-label="Move up"
                  >
                    <ArrowUp className="h-3 w-3" />
                  </button>
                  <button
                    type="button"
                    onClick={() => move(b.id, 1)}
                    className="text-[hsl(var(--e-muted-foreground))] hover:text-[hsl(var(--e-foreground))]"
                    aria-label="Move down"
                  >
                    <ArrowDown className="h-3 w-3" />
                  </button>
                  <button
                    type="button"
                    onClick={() => removeBlock(b.id)}
                    className="text-[hsl(var(--e-muted-foreground))] hover:text-[hsl(var(--e-danger))]"
                    aria-label="Delete block"
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                </div>
              );
            })}
            {design.blocks.length === 0 ? (
              <p className="text-[0.75rem] text-[hsl(var(--e-text-faint))]">
                No blocks yet — add one above.
              </p>
            ) : null}
          </div>
        </div>
      </div>

      {/* Live preview */}
      <div>
        <p className="mb-2 text-[0.6875rem] font-semibold uppercase tracking-[0.14em] text-[hsl(var(--e-gold-ink))]">
          Live preview
        </p>
        <div className="rounded-[var(--e-radius-lg)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface-sunken))] p-2">
          <iframe
            title="Email preview"
            srcDoc={previewHtml}
            className="h-[460px] w-full rounded-[var(--e-radius)] border-0 bg-white"
          />
        </div>
      </div>

      {/* Inspector */}
      <div className="space-y-3 rounded-[var(--e-radius-lg)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface-raised))] p-3">
        <p className="text-[0.6875rem] font-semibold uppercase tracking-[0.14em] text-[hsl(var(--e-gold-ink))]">
          {selected ? `${selected.type} settings` : "Email frame"}
        </p>

        {!selected ? (
          <div className="space-y-3">
            <ColorField
              label="Page background"
              value={design.pageBackground}
              onChange={(v) => update({ pageBackground: v })}
            />
            <ColorField
              label="Card background"
              value={design.cardBackground}
              onChange={(v) => update({ cardBackground: v })}
            />
            <p className="text-[0.75rem] text-[hsl(var(--e-text-faint))]">
              Select a block to edit it, or add one from the left.
            </p>
          </div>
        ) : null}

        {selected && "text" in selected ? (
          <EField label="Content">
            <ETextarea
              rows={3}
              value={(selected as any).text}
              onChange={(e) =>
                updateBlock(selected.id, {
                  text: e.target.value,
                } as Partial<EmailBlock>)
              }
              placeholder="Text…"
            />
          </EField>
        ) : null}

        {selected &&
        (selected.type === "heading" ||
          selected.type === "text" ||
          selected.type === "button" ||
          selected.type === "image") ? (
          <AlignField
            value={(selected as any).align}
            onChange={(v) =>
              updateBlock(selected.id, { align: v } as Partial<EmailBlock>)
            }
          />
        ) : null}

        {selected && (selected.type === "heading" || selected.type === "text") ? (
          <>
            <NumberField
              label="Font size"
              value={(selected as any).fontSize}
              onChange={(v) =>
                updateBlock(selected.id, {
                  fontSize: v,
                } as Partial<EmailBlock>)
              }
            />
            <ColorField
              label="Text colour"
              value={(selected as any).color}
              onChange={(v) =>
                updateBlock(selected.id, { color: v } as Partial<EmailBlock>)
              }
            />
          </>
        ) : null}

        {selected && selected.type === "button" ? (
          <>
            <TextField
              label="Link (href)"
              value={selected.href}
              onChange={(v) => updateBlock(selected.id, { href: v })}
            />
            <ColorField
              label="Button colour"
              value={selected.bg}
              onChange={(v) => updateBlock(selected.id, { bg: v })}
            />
            <ColorField
              label="Text colour"
              value={selected.color}
              onChange={(v) => updateBlock(selected.id, { color: v })}
            />
            <NumberField
              label="Corner radius"
              value={selected.radius}
              onChange={(v) => updateBlock(selected.id, { radius: v })}
            />
          </>
        ) : null}

        {selected && selected.type === "image" ? (
          <>
            <TextField
              label="Image URL"
              value={selected.src}
              onChange={(v) => updateBlock(selected.id, { src: v })}
            />
            <TextField
              label="Alt text"
              value={selected.alt}
              onChange={(v) => updateBlock(selected.id, { alt: v })}
            />
            <TextField
              label="Link (optional)"
              value={selected.href ?? ""}
              onChange={(v) => updateBlock(selected.id, { href: v })}
            />
            <NumberField
              label="Width (px)"
              value={selected.width}
              onChange={(v) => updateBlock(selected.id, { width: v })}
            />
          </>
        ) : null}

        {selected && selected.type === "divider" ? (
          <ColorField
            label="Line colour"
            value={selected.color}
            onChange={(v) => updateBlock(selected.id, { color: v })}
          />
        ) : null}

        {selected && selected.type === "spacer" ? (
          <NumberField
            label="Height (px)"
            value={selected.height}
            onChange={(v) => updateBlock(selected.id, { height: v })}
          />
        ) : null}

        {selected && "text" in selected && variables.length > 0 ? (
          <div>
            <p className="mb-1.5 text-[0.6875rem] font-semibold uppercase tracking-[0.14em] text-[hsl(var(--e-gold-ink))]">
              Insert variable
            </p>
            <VariableChips variables={variables} onInsert={insertVar} />
          </div>
        ) : null}
      </div>
    </div>
  );
}

export function VariableChips({
  variables,
  onInsert,
}: {
  variables: string[];
  onInsert: (v: string) => void;
}) {
  return (
    <div className="flex flex-wrap gap-1">
      {variables.map((v) => (
        <button
          key={v}
          type="button"
          onClick={() => onInsert(v)}
          className="rounded-[var(--e-radius-pill)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface))] px-2 py-0.5 font-mono text-[0.6875rem] text-[hsl(var(--e-text-secondary))] transition-colors hover:border-[hsl(var(--e-gold)/0.5)] hover:text-[hsl(var(--e-foreground))]"
        >
          {v}
        </button>
      ))}
    </div>
  );
}

function TextField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <EField label={label}>
      <EInput value={value} onChange={(e) => onChange(e.target.value)} />
    </EField>
  );
}

function NumberField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <EField label={label}>
      <EInput
        type="number"
        value={value}
        onChange={(e) => onChange(Number(e.target.value) || 0)}
      />
    </EField>
  );
}

function ColorField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <EField label={label}>
      <div className="flex items-center gap-2">
        <input
          type="color"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className={swatchBtn}
        />
        <EInput
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="font-mono text-[0.75rem]"
        />
      </div>
    </EField>
  );
}

function AlignField({
  value,
  onChange,
}: {
  value: EmailBlockAlign;
  onChange: (v: EmailBlockAlign) => void;
}) {
  return (
    <EField label="Alignment">
      <div className="flex gap-1">
        {(["left", "center", "right"] as const).map((a) => (
          <button
            key={a}
            type="button"
            onClick={() => onChange(a)}
            className={`flex-1 rounded-[var(--e-radius)] border px-2 py-1 text-[0.75rem] capitalize transition-colors ${
              value === a
                ? "border-[hsl(var(--e-primary))] bg-[hsl(var(--e-primary)/0.06)] text-[hsl(var(--e-foreground))]"
                : "border-[hsl(var(--e-border))] text-[hsl(var(--e-muted-foreground))]"
            }`}
          >
            {a}
          </button>
        ))}
      </div>
    </EField>
  );
}
