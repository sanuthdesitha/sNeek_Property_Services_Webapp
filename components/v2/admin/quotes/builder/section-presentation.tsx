"use client";

/**
 * 4 · Quote and email presentation: heading, email subject and message
 * (stored in the notes META, blank = defaults), the email preview, client
 * reference photos (uploaded through the direct upload route, max 12) and
 * "Show add-on prices to client".
 */
import * as React from "react";
import { ImagePlus, Loader2, Trash2 } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { EButton } from "@/components/v2/ui/primitives";
import { EConfirmButton, EField, EInput, ESwitch, ETextarea } from "@/components/v2/admin/estate-kit";
import { SectionCard } from "./section-card";
import type { ReferenceImage } from "./model";
import type { QuoteBuilderState } from "./use-quote-builder";

async function uploadOne(file: File): Promise<ReferenceImage> {
  const form = new FormData();
  form.append("file", file);
  form.append("folder", "quote-references");
  const res = await fetch("/api/uploads/direct", { method: "POST", body: form });
  const body = (await res.json().catch(() => ({}))) as { url?: string; key?: string; error?: string };
  if (!res.ok || !body?.url) throw new Error(body?.error ?? `Could not upload ${file.name}.`);
  return { key: String(body.key ?? body.url), url: String(body.url) };
}

function ReferencePhotos({ builder }: { builder: QuoteBuilderState }) {
  const [uploading, setUploading] = React.useState(false);
  const input = React.useRef<HTMLInputElement | null>(null);

  async function upload(files: FileList | null) {
    if (!files || files.length === 0) return;
    setUploading(true);
    try {
      const uploaded: ReferenceImage[] = [];
      for (const file of Array.from(files)) uploaded.push(await uploadOne(file));
      builder.setRefImages((prev) => [...prev, ...uploaded].slice(0, 12));
    } catch (err) {
      toast({ title: "Upload failed", description: err instanceof Error ? err.message : String(err), variant: "destructive" });
    } finally {
      setUploading(false);
      if (input.current) input.current.value = "";
    }
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">Client reference photos</span>
        <EButton type="button" size="sm" variant="outline" onClick={() => input.current?.click()} disabled={uploading}>
          {uploading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ImagePlus className="h-3.5 w-3.5" />} {uploading ? "Uploading…" : "Add photos"}
        </EButton>
        <input ref={input} type="file" accept="image/*" multiple className="hidden" aria-label="Choose reference photos" onChange={(e) => void upload(e.target.files)} />
      </div>
      {builder.refImages.length === 0 ? (
        <p className="text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">No reference photos added. Photos are attached to the quote email and shown on the quote.</p>
      ) : (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-6">
          {builder.refImages.map((img, idx) => (
            <div key={img.key} className="space-y-1.5 rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] p-1.5">
              <div className="relative">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={img.url} alt={img.label || `Reference ${idx + 1}`} className="h-20 w-full rounded-[var(--e-radius)] object-cover" />
                <EConfirmButton
                  ariaLabel="Remove reference image"
                  confirmLabel={<span className="text-[0.625rem] font-[600]">Sure?</span>}
                  className="absolute right-1 top-1 inline-flex h-7 items-center justify-center rounded-[var(--e-radius)] bg-[hsl(var(--e-surface)/0.9)] px-1.5 text-[hsl(var(--e-danger))]"
                  onConfirm={() => builder.setRefImages((prev) => prev.filter((r) => r.key !== img.key))}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </EConfirmButton>
              </div>
              <EInput aria-label={`Label for reference ${idx + 1}`} value={img.label ?? ""} placeholder="Label (optional)" className="h-8 text-[0.75rem]" onChange={(e) => builder.setRefImages((prev) => prev.map((r) => (r.key === img.key ? { ...r, label: e.target.value } : r)))} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function SectionPresentation({ builder, onEmailPreview, emailPreviewReason, locked }: { builder: QuoteBuilderState; onEmailPreview: () => void; emailPreviewReason: string | null; locked: boolean }) {
  return (
    <SectionCard
      eyebrow="4 · Quote and email presentation"
      aside={
        <span className="flex flex-wrap items-center gap-2">
          <EButton type="button" size="sm" variant="outline" onClick={onEmailPreview} disabled={Boolean(emailPreviewReason)} title={emailPreviewReason ?? undefined}>Email preview</EButton>
          {emailPreviewReason ? <span className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">{emailPreviewReason}</span> : null}
        </span>
      }
    >
      <fieldset disabled={locked} className="min-w-0 space-y-4">
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <EField label="Quote heading" hint="Blank: the service name.">
          <EInput value={builder.quoteHeading} placeholder="e.g. Move-in clean quote" onChange={(e) => builder.setQuoteHeading(e.target.value)} />
        </EField>
        <EField label="Email subject" hint="Blank: the standard quote subject.">
          <EInput value={builder.emailSubject} placeholder={`e.g. Your ${builder.pricing.serviceLabel} quote from sNeek`} onChange={(e) => builder.setEmailSubject(e.target.value)} />
        </EField>
      </div>
      <EField label="Message to client" hint="Shown in the quote email, above the pricing.">
        <ETextarea value={builder.emailMessage} placeholder="A short personal note to the client…" onChange={(e) => builder.setEmailMessage(e.target.value)} />
      </EField>
      <ReferencePhotos builder={builder} />
      </fieldset>
      <ESwitch
        checked={builder.showAddOnPrices}
        onCheckedChange={builder.setShowAddOnPrices}
        disabled={builder.saving}
        label={
          <>
            Show add-on prices to client <span className="text-[hsl(var(--e-text-faint))]">(off: the attached add-on list shows “on request”)</span>
          </>
        }
      />
    </SectionCard>
  );
}
