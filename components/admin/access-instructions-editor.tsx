"use client";

import * as React from "react";
import { FileText, Plus, Trash2, Upload, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "@/hooks/use-toast";
import { ACCESS_CATEGORY_LABELS } from "@/components/shared/access-instructions-panel";

export type AccessPhoto = { key?: string; url: string; label?: string };
export type AccessSection = {
  id: string;
  category: string;
  title: string;
  instructions?: string;
  code?: string;
  photos: AccessPhoto[];
};

const CATEGORY_ORDER = [
  "CLEANERS_CUPBOARD",
  "LOCKBOX",
  "MAIN_ENTRANCE",
  "BIN_ROOM",
  "LAUNDRY_DROPOFF",
  "LAUNDRY_PICKUP",
  "PARKING",
  "WIFI",
  "OTHER",
];

function uid() {
  return `sec-${Math.random().toString(36).slice(2, 9)}`;
}

async function uploadDirect(file: File, folder: string): Promise<{ key: string; url: string }> {
  const form = new FormData();
  form.append("file", file);
  form.append("folder", folder);
  const res = await fetch("/api/uploads/direct", { method: "POST", body: form });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body?.key) throw new Error(body?.error ?? "Upload failed");
  return { key: body.key, url: body.url };
}

/**
 * Authoring UI for a property's access instructions: either an uploaded PDF
 * (which replaces the structured detail) OR a set of per-location sections with
 * photos + codes + notes (cupboard, lockbox, entrance, bin room, laundry, …).
 */
export function AccessInstructionsEditor({
  sections,
  pdfUrl,
  onChange,
}: {
  sections: AccessSection[];
  pdfUrl: string | null;
  onChange: (next: { sections: AccessSection[]; pdfUrl: string | null }) => void;
}) {
  const [busy, setBusy] = React.useState<string | null>(null);

  const setSections = (next: AccessSection[]) => onChange({ sections: next, pdfUrl });
  const setPdf = (next: string | null) => onChange({ sections, pdfUrl: next });

  const patchSection = (id: string, patch: Partial<AccessSection>) =>
    setSections(sections.map((s) => (s.id === id ? { ...s, ...patch } : s)));

  const addSection = () =>
    setSections([
      ...sections,
      { id: uid(), category: "CLEANERS_CUPBOARD", title: "", instructions: "", code: "", photos: [] },
    ]);

  async function addPhotos(sectionId: string, files: FileList | null) {
    if (!files || files.length === 0) return;
    setBusy(sectionId);
    try {
      const uploaded: AccessPhoto[] = [];
      for (const file of Array.from(files)) {
        const { key, url } = await uploadDirect(file, "property/access");
        uploaded.push({ key, url, label: file.name });
      }
      const target = sections.find((s) => s.id === sectionId);
      if (target) patchSection(sectionId, { photos: [...target.photos, ...uploaded] });
    } catch (err: any) {
      toast({ title: "Photo upload failed", description: err.message, variant: "destructive" });
    } finally {
      setBusy(null);
    }
  }

  async function uploadPdf(files: FileList | null) {
    const file = files?.[0];
    if (!file) return;
    setBusy("pdf");
    try {
      const { url } = await uploadDirect(file, "property/access-pdf");
      setPdf(url);
      toast({ title: "Access guide PDF uploaded" });
    } catch (err: any) {
      toast({ title: "PDF upload failed", description: err.message, variant: "destructive" });
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-4">
      {/* PDF option */}
      <div className="rounded-lg border border-border bg-muted/20 p-3">
        <p className="text-sm font-medium">Full access guide (PDF)</p>
        <p className="text-xs text-muted-foreground">
          Optional. When a PDF is attached, cleaners can view/download it — no detailed sections are needed.
        </p>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-border bg-background px-2.5 py-1.5 text-xs hover:bg-muted">
            <Upload className="h-3.5 w-3.5" /> {pdfUrl ? "Replace PDF" : "Upload PDF"}
            <input type="file" accept="application/pdf" className="hidden" disabled={busy === "pdf"}
              onChange={(e) => { const el = e.currentTarget; void uploadPdf(el.files).then(() => (el.value = "")); }} />
          </label>
          {pdfUrl ? (
            <>
              <a href={pdfUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline">
                <FileText className="h-3.5 w-3.5" /> View current PDF
              </a>
              <button type="button" className="text-xs text-muted-foreground hover:text-destructive" onClick={() => setPdf(null)}>Remove</button>
            </>
          ) : null}
          {busy === "pdf" ? <span className="text-xs text-muted-foreground">Uploading…</span> : null}
        </div>
      </div>

      {/* Structured sections */}
      <div className="space-y-3">
        {sections.map((section) => (
          <div key={section.id} className="space-y-2 rounded-lg border border-border p-3">
            <div className="flex items-center gap-2">
              <Select value={section.category} onValueChange={(v) => patchSection(section.id, { category: v })}>
                <SelectTrigger className="h-8 w-48 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {CATEGORY_ORDER.map((c) => (
                    <SelectItem key={c} value={c} className="text-xs">{ACCESS_CATEGORY_LABELS[c] ?? c}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Input
                className="h-8 flex-1 text-xs"
                placeholder="Title (e.g. Cupboard by the lift on level 2)"
                value={section.title}
                onChange={(e) => patchSection(section.id, { title: e.target.value })}
              />
              <Input
                className="h-8 w-28 text-xs"
                placeholder="Code"
                value={section.code ?? ""}
                onChange={(e) => patchSection(section.id, { code: e.target.value })}
              />
              <button type="button" className="rounded p-1 text-muted-foreground hover:text-destructive"
                onClick={() => setSections(sections.filter((s) => s.id !== section.id))} aria-label="Remove section">
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
            <Textarea
              rows={2}
              className="text-xs"
              placeholder="Instructions — how to find/use it, what to do, anything a new person needs to know."
              value={section.instructions ?? ""}
              onChange={(e) => patchSection(section.id, { instructions: e.target.value })}
            />
            <div className="flex flex-wrap items-center gap-2">
              {section.photos.map((p, i) => (
                <div key={p.key ?? p.url} className="relative">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={p.url} alt={p.label ?? "Access photo"} className="h-16 w-16 rounded border object-cover" />
                  <button type="button"
                    className="absolute -right-1.5 -top-1.5 rounded-full bg-background p-0.5 text-destructive shadow"
                    onClick={() => patchSection(section.id, { photos: section.photos.filter((_, idx) => idx !== i) })}
                    aria-label="Remove photo">
                    <X className="h-3 w-3" />
                  </button>
                </div>
              ))}
              <label className="inline-flex cursor-pointer items-center gap-1 rounded-lg border border-dashed border-border px-2 py-1 text-xs hover:bg-muted">
                <Plus className="h-3.5 w-3.5" /> {busy === section.id ? "Uploading…" : "Add photos"}
                <input type="file" accept="image/*" multiple className="hidden" disabled={busy === section.id}
                  onChange={(e) => { const el = e.currentTarget; void addPhotos(section.id, el.files).then(() => (el.value = "")); }} />
              </label>
            </div>
          </div>
        ))}
        <Button type="button" variant="outline" size="sm" onClick={addSection}>
          <Plus className="mr-1 h-3.5 w-3.5" /> Add access location
        </Button>
      </div>
    </div>
  );
}
