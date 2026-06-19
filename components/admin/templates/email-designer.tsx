"use client";

import { useMemo, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  Heading,
  Image as ImageIcon,
  Minus,
  MousePointerClick,
  Plus,
  Trash2,
  Type,
  StretchVertical,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  EMAIL_BLOCK_TYPES,
  type EmailBlock,
  type EmailBlockAlign,
  type EmailDesign,
  makeBlock,
  renderEmailHtml,
} from "@/lib/templates/email-blocks";

const TYPE_ICON: Record<EmailBlock["type"], typeof Type> = {
  heading: Heading,
  text: Type,
  button: MousePointerClick,
  image: ImageIcon,
  divider: Minus,
  spacer: StretchVertical,
};

export function EmailDesigner({
  design,
  onChange,
  variables,
}: {
  design: EmailDesign;
  onChange: (next: EmailDesign) => void;
  variables: string[];
}) {
  const [selectedId, setSelectedId] = useState<string | null>(design.blocks[0]?.id ?? null);
  const selected = design.blocks.find((b) => b.id === selectedId) ?? null;
  const previewHtml = useMemo(() => renderEmailHtml(design), [design]);

  function update(next: Partial<EmailDesign>) {
    onChange({ ...design, ...next });
  }
  function updateBlock(id: string, patch: Partial<EmailBlock>) {
    update({ blocks: design.blocks.map((b) => (b.id === id ? ({ ...b, ...patch } as EmailBlock) : b)) });
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
    updateBlock(selected.id, { text: `${(selected as any).text}{{${v}}}` } as Partial<EmailBlock>);
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[230px_1fr_300px]">
      {/* Block list / palette */}
      <div className="space-y-3">
        <div>
          <Label className="text-xs uppercase tracking-wide text-muted-foreground">Add block</Label>
          <div className="mt-2 grid grid-cols-3 gap-1.5">
            {EMAIL_BLOCK_TYPES.map(({ type, label }) => {
              const Icon = TYPE_ICON[type];
              return (
                <button
                  key={type}
                  onClick={() => addBlock(type)}
                  title={label}
                  className="flex flex-col items-center gap-1 rounded-lg border p-2 text-[11px] transition hover:border-primary/50 hover:bg-muted/40"
                >
                  <Icon className="h-4 w-4" />
                  {label}
                </button>
              );
            })}
          </div>
        </div>

        <div>
          <Label className="text-xs uppercase tracking-wide text-muted-foreground">Layers</Label>
          <div className="mt-2 space-y-1">
            {design.blocks.map((b) => {
              const Icon = TYPE_ICON[b.type];
              return (
                <div
                  key={b.id}
                  className={`flex items-center gap-1.5 rounded-md border px-2 py-1.5 text-xs ${
                    b.id === selectedId ? "border-primary bg-primary/5" : ""
                  }`}
                >
                  <button onClick={() => setSelectedId(b.id)} className="flex flex-1 items-center gap-1.5 text-left">
                    <Icon className="h-3.5 w-3.5 shrink-0" />
                    <span className="truncate capitalize">{"text" in b && b.text ? b.text : b.type}</span>
                  </button>
                  <button onClick={() => move(b.id, -1)} className="text-muted-foreground hover:text-foreground"><ArrowUp className="h-3 w-3" /></button>
                  <button onClick={() => move(b.id, 1)} className="text-muted-foreground hover:text-foreground"><ArrowDown className="h-3 w-3" /></button>
                  <button onClick={() => removeBlock(b.id)} className="text-muted-foreground hover:text-destructive"><Trash2 className="h-3 w-3" /></button>
                </div>
              );
            })}
            {design.blocks.length === 0 && <p className="text-xs text-muted-foreground">No blocks yet — add one above.</p>}
          </div>
        </div>
      </div>

      {/* Live preview */}
      <div className="rounded-xl border bg-muted/30 p-2">
        <iframe title="Email preview" srcDoc={previewHtml} className="h-[520px] w-full rounded-lg border-0 bg-white" />
      </div>

      {/* Inspector */}
      <div className="space-y-3 rounded-xl border p-3">
        <Label className="text-xs uppercase tracking-wide text-muted-foreground">
          {selected ? `${selected.type} settings` : "Email settings"}
        </Label>

        {!selected && (
          <div className="space-y-3">
            <ColorField label="Page background" value={design.pageBackground} onChange={(v) => update({ pageBackground: v })} />
            <ColorField label="Card background" value={design.cardBackground} onChange={(v) => update({ cardBackground: v })} />
            <p className="text-xs text-muted-foreground">Select a block to edit it, or add one from the left.</p>
          </div>
        )}

        {selected && "text" in selected && (
          <Textarea
            value={(selected as any).text}
            onChange={(e) => updateBlock(selected.id, { text: e.target.value } as Partial<EmailBlock>)}
            rows={3}
            placeholder="Text…"
          />
        )}

        {selected && (selected.type === "heading" || selected.type === "text" || selected.type === "button" || selected.type === "image") && (
          <AlignField value={(selected as any).align} onChange={(v) => updateBlock(selected.id, { align: v } as Partial<EmailBlock>)} />
        )}

        {selected && (selected.type === "heading" || selected.type === "text") && (
          <>
            <NumberField label="Font size" value={(selected as any).fontSize} onChange={(v) => updateBlock(selected.id, { fontSize: v } as Partial<EmailBlock>)} />
            <ColorField label="Text colour" value={(selected as any).color} onChange={(v) => updateBlock(selected.id, { color: v } as Partial<EmailBlock>)} />
          </>
        )}

        {selected && selected.type === "button" && (
          <>
            <TextField label="Link (href)" value={selected.href} onChange={(v) => updateBlock(selected.id, { href: v })} />
            <ColorField label="Button colour" value={selected.bg} onChange={(v) => updateBlock(selected.id, { bg: v })} />
            <ColorField label="Text colour" value={selected.color} onChange={(v) => updateBlock(selected.id, { color: v })} />
            <NumberField label="Corner radius" value={selected.radius} onChange={(v) => updateBlock(selected.id, { radius: v })} />
          </>
        )}

        {selected && selected.type === "image" && (
          <>
            <TextField label="Image URL" value={selected.src} onChange={(v) => updateBlock(selected.id, { src: v })} />
            <TextField label="Alt text" value={selected.alt} onChange={(v) => updateBlock(selected.id, { alt: v })} />
            <TextField label="Link (optional)" value={selected.href ?? ""} onChange={(v) => updateBlock(selected.id, { href: v })} />
            <NumberField label="Width (px)" value={selected.width} onChange={(v) => updateBlock(selected.id, { width: v })} />
          </>
        )}

        {selected && selected.type === "divider" && (
          <ColorField label="Line colour" value={selected.color} onChange={(v) => updateBlock(selected.id, { color: v })} />
        )}

        {selected && selected.type === "spacer" && (
          <NumberField label="Height (px)" value={selected.height} onChange={(v) => updateBlock(selected.id, { height: v })} />
        )}

        {selected && "text" in selected && variables.length > 0 && (
          <div>
            <Label className="text-xs uppercase tracking-wide text-muted-foreground">Insert variable</Label>
            <div className="mt-1.5 flex flex-wrap gap-1">
              {variables.map((v) => (
                <button key={v} onClick={() => insertVar(v)} className="rounded-full border bg-muted/40 px-2 py-0.5 font-mono text-[11px] hover:border-primary/50">
                  {v}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function TextField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div className="space-y-1">
      <Label className="text-xs">{label}</Label>
      <Input value={value} onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}
function NumberField({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  return (
    <div className="space-y-1">
      <Label className="text-xs">{label}</Label>
      <Input type="number" value={value} onChange={(e) => onChange(Number(e.target.value) || 0)} />
    </div>
  );
}
function ColorField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div className="space-y-1">
      <Label className="text-xs">{label}</Label>
      <div className="flex items-center gap-2">
        <input type="color" value={value} onChange={(e) => onChange(e.target.value)} className="h-8 w-10 cursor-pointer rounded border" />
        <Input value={value} onChange={(e) => onChange(e.target.value)} className="font-mono text-xs" />
      </div>
    </div>
  );
}
function AlignField({ value, onChange }: { value: EmailBlockAlign; onChange: (v: EmailBlockAlign) => void }) {
  return (
    <div className="space-y-1">
      <Label className="text-xs">Alignment</Label>
      <div className="flex gap-1">
        {(["left", "center", "right"] as const).map((a) => (
          <button
            key={a}
            onClick={() => onChange(a)}
            className={`flex-1 rounded-md border px-2 py-1 text-xs capitalize ${value === a ? "border-primary bg-primary/5" : ""}`}
          >
            {a}
          </button>
        ))}
      </div>
    </div>
  );
}
