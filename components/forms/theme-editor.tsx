"use client";

import * as React from "react";
import { ImagePlus, Loader2, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import type { FormTheme } from "@/lib/forms/types";

export interface ThemeEditorProps {
  theme: FormTheme | undefined;
  onChange: (next: FormTheme | undefined) => void;
}

const FONT_OPTIONS: Array<{ value: string; label: string }> = [
  { value: "", label: "Default (app font)" },
  { value: "Georgia, 'Times New Roman', serif", label: "Serif (Georgia)" },
  { value: "'Helvetica Neue', Arial, sans-serif", label: "Sans (Helvetica)" },
  { value: "'Courier New', monospace", label: "Mono (Courier)" },
  { value: "'Trebuchet MS', sans-serif", label: "Trebuchet" },
  { value: "Verdana, Geneva, sans-serif", label: "Verdana" },
];

const DEFAULT_ACCENT = "#0d9488";
const DEFAULT_HEADER = "#0f172a";

// Resolve an uploaded logo storageKey to a viewable URL via the admin access
// endpoint (same pattern as reference-media-editor).
async function resolveLogoUrl(theme: FormTheme | undefined): Promise<string> {
  if (!theme) return "";
  if (theme.logoUrl) return theme.logoUrl;
  if (theme.logoKey) {
    try {
      const res = await fetch(`/api/uploads/access?key=${encodeURIComponent(theme.logoKey)}`);
      const body = await res.json().catch(() => ({}));
      if (res.ok && body.url) return body.url as string;
    } catch {
      /* ignore */
    }
  }
  return "";
}

export function ThemeEditor({ theme, onChange }: ThemeEditorProps) {
  const [uploading, setUploading] = React.useState(false);
  const [uploadError, setUploadError] = React.useState<string | null>(null);
  const [logoPreview, setLogoPreview] = React.useState("");

  const t = theme ?? {};

  React.useEffect(() => {
    let cancelled = false;
    void resolveLogoUrl(theme).then((url) => {
      if (!cancelled) setLogoPreview(url);
    });
    return () => {
      cancelled = true;
    };
  }, [theme]);

  function patch(next: Partial<FormTheme>) {
    const merged: FormTheme = { ...t, ...next };
    // Drop empty-string values so the schema stays clean / falls back to tokens.
    (Object.keys(merged) as Array<keyof FormTheme>).forEach((key) => {
      const value = merged[key];
      if (value === "" || value === undefined) delete merged[key];
    });
    const hasAny = Object.keys(merged).length > 0;
    onChange(hasAny ? merged : undefined);
  }

  async function handleLogoUpload(files: FileList | null) {
    const file = files?.[0];
    if (!file) return;
    setUploading(true);
    setUploadError(null);
    try {
      // Upload THROUGH the server (/api/uploads/direct) — the previous
      // presigned browser PUT silently failed in production (no bucket CORS
      // for the site origin, and the PUT's result was never checked), leaving
      // a logoKey pointing at an object that was never uploaded.
      const fd = new FormData();
      fd.append("file", file);
      fd.append("folder", "form-theme");
      const res = await fetch("/api/uploads/direct", { method: "POST", body: fd });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || !body.key) {
        setUploadError(body.error ?? `Logo upload failed (${res.status}).`);
        return;
      }
      // Store the key; the view URL is resolved at render time. Clear any
      // previously-set external logoUrl so the uploaded one wins.
      patch({ logoKey: body.key as string, logoUrl: undefined });
    } catch {
      setUploadError("Logo upload failed — check your connection and try again.");
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="space-y-5">
      <div>
        <p className="text-sm font-medium">Form appearance</p>
        <p className="text-xs text-muted-foreground">
          These styles apply only to the form body the cleaner fills in — never the
          surrounding app. Everything is optional.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="theme-accent">Accent colour</Label>
          <div className="flex items-center gap-2">
            <input
              id="theme-accent"
              type="color"
              value={t.accentColor || DEFAULT_ACCENT}
              onChange={(e) => patch({ accentColor: e.target.value })}
              className="h-11 w-14 cursor-pointer rounded-md border bg-background p-1"
              aria-label="Accent colour"
            />
            <Input
              value={t.accentColor ?? ""}
              onChange={(e) => patch({ accentColor: e.target.value || undefined })}
              placeholder={DEFAULT_ACCENT}
              className="font-mono text-xs"
            />
          </div>
          <p className="text-[11px] text-muted-foreground">
            Buttons, ticks, ratings and progress.
          </p>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="theme-header">Section heading colour</Label>
          <div className="flex items-center gap-2">
            <input
              id="theme-header"
              type="color"
              value={t.headerColor || DEFAULT_HEADER}
              onChange={(e) => patch({ headerColor: e.target.value })}
              className="h-11 w-14 cursor-pointer rounded-md border bg-background p-1"
              aria-label="Section heading colour"
            />
            <Input
              value={t.headerColor ?? ""}
              onChange={(e) => patch({ headerColor: e.target.value || undefined })}
              placeholder={DEFAULT_HEADER}
              className="font-mono text-xs"
            />
          </div>
        </div>
      </div>

      <div className="space-y-2">
        <Label>Logo</Label>
        <div className="flex items-center gap-3">
          <div className="flex size-16 shrink-0 items-center justify-center overflow-hidden rounded-md border bg-muted">
            {logoPreview ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={logoPreview} alt="Form logo" className="size-16 object-contain" />
            ) : (
              <ImagePlus className="size-5 text-muted-foreground" />
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <label className="inline-flex h-11 cursor-pointer items-center gap-1 rounded-md border bg-background px-3 text-xs hover:bg-muted">
              {uploading ? <Loader2 className="size-3.5 animate-spin" /> : <ImagePlus className="size-3.5" />}
              {uploading ? "Uploading…" : "Upload logo"}
              <input
                type="file"
                accept="image/*"
                className="hidden"
                disabled={uploading}
                onChange={(e) => {
                  void handleLogoUpload(e.target.files);
                  e.currentTarget.value = "";
                }}
              />
            </label>
            {(t.logoKey || t.logoUrl) && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-11"
                onClick={() => patch({ logoKey: undefined, logoUrl: undefined })}
              >
                <Trash2 className="mr-1 size-4 text-destructive" />
                Remove
              </Button>
            )}
          </div>
        </div>
        {uploadError ? <p className="text-xs text-destructive">{uploadError}</p> : null}
        <Input
          value={t.logoUrl ?? ""}
          onChange={(e) => patch({ logoUrl: e.target.value || undefined, logoKey: undefined })}
          placeholder="…or paste a logo image URL"
          className="text-xs"
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="theme-heading-font">Heading font</Label>
          <Select
            value={t.headingFont || "__default__"}
            onValueChange={(v) => patch({ headingFont: v === "__default__" ? undefined : v })}
          >
            <SelectTrigger id="theme-heading-font">
              <SelectValue placeholder="Default" />
            </SelectTrigger>
            <SelectContent>
              {FONT_OPTIONS.map((f) => (
                <SelectItem key={f.label} value={f.value || "__default__"}>
                  {f.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="theme-body-font">Body font</Label>
          <Select
            value={t.bodyFont || "__default__"}
            onValueChange={(v) => patch({ bodyFont: v === "__default__" ? undefined : v })}
          >
            <SelectTrigger id="theme-body-font">
              <SelectValue placeholder="Default" />
            </SelectTrigger>
            <SelectContent>
              {FONT_OPTIONS.map((f) => (
                <SelectItem key={f.label} value={f.value || "__default__"}>
                  {f.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="flex items-center justify-between rounded-md border p-3">
        <div>
          <Label htmlFor="theme-dividers">Divider lines between sections</Label>
          <p className="text-[11px] text-muted-foreground">
            Draws a line under each section heading.
          </p>
        </div>
        <Switch
          id="theme-dividers"
          checked={Boolean(t.showDividers)}
          onCheckedChange={(checked) => patch({ showDividers: checked || undefined })}
        />
      </div>

      {theme ? (
        <Button type="button" variant="ghost" size="sm" onClick={() => onChange(undefined)}>
          Reset theme to default
        </Button>
      ) : null}
    </div>
  );
}
