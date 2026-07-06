"use client";

/**
 * ESTATE form builder — form theme editor. Same FormTheme shape v1 stores
 * (accentColor / headerColor / logoKey|logoUrl / showDividers / heading &
 * body fonts). Reuses the shared upload endpoints (/api/uploads/presign,
 * /api/uploads/access). Native Estate controls.
 */
import * as React from "react";
import { ImagePlus, Loader2, Trash2 } from "lucide-react";
import type { FormTheme } from "@/lib/forms/types";
import { EButton } from "@/components/v2/ui/primitives";
import { EField, EInput, ESelect, ESwitch } from "@/components/v2/admin/estate-kit";

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

export function ThemeEditor({
  theme,
  onChange,
}: {
  theme: FormTheme | undefined;
  onChange: (next: FormTheme | undefined) => void;
}) {
  const [uploading, setUploading] = React.useState(false);
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
    (Object.keys(merged) as Array<keyof FormTheme>).forEach((key) => {
      const value = merged[key];
      if (value === "" || value === undefined) delete merged[key];
    });
    onChange(Object.keys(merged).length > 0 ? merged : undefined);
  }

  async function handleLogoUpload(files: FileList | null) {
    const file = files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const presignRes = await fetch("/api/uploads/presign", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          filename: file.name,
          contentType: file.type || "image/png",
          folder: "form-theme",
        }),
      });
      const presign = await presignRes.json().catch(() => ({}));
      if (!presignRes.ok || !presign.uploadUrl || !presign.key) return;
      await fetch(presign.uploadUrl, {
        method: "PUT",
        headers: { "Content-Type": file.type || "image/png" },
        body: file,
      });
      patch({ logoKey: presign.key, logoUrl: undefined });
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="space-y-5">
      <p className="text-[0.8125rem] text-[hsl(var(--e-text-secondary))]">
        These styles apply only to the form body the cleaner fills in — never the surrounding portal.
        Everything is optional.
      </p>

      <div className="grid gap-4 sm:grid-cols-2">
        <EField label="Accent colour" hint="Buttons, ticks, ratings, progress.">
          <div className="flex items-center gap-2">
            <input
              type="color"
              value={t.accentColor || DEFAULT_ACCENT}
              onChange={(e) => patch({ accentColor: e.target.value })}
              className="h-10 w-12 shrink-0 cursor-pointer rounded-[var(--e-radius)] border border-[hsl(var(--e-input))] bg-[hsl(var(--e-surface))] p-1"
              aria-label="Accent colour"
            />
            <EInput
              value={t.accentColor ?? ""}
              onChange={(e) => patch({ accentColor: e.target.value || undefined })}
              placeholder={DEFAULT_ACCENT}
              className="font-mono text-[0.75rem]"
            />
          </div>
        </EField>

        <EField label="Section heading colour">
          <div className="flex items-center gap-2">
            <input
              type="color"
              value={t.headerColor || DEFAULT_HEADER}
              onChange={(e) => patch({ headerColor: e.target.value })}
              className="h-10 w-12 shrink-0 cursor-pointer rounded-[var(--e-radius)] border border-[hsl(var(--e-input))] bg-[hsl(var(--e-surface))] p-1"
              aria-label="Section heading colour"
            />
            <EInput
              value={t.headerColor ?? ""}
              onChange={(e) => patch({ headerColor: e.target.value || undefined })}
              placeholder={DEFAULT_HEADER}
              className="font-mono text-[0.75rem]"
            />
          </div>
        </EField>
      </div>

      <EField label="Logo">
        <div className="flex items-center gap-3">
          <div className="flex size-16 shrink-0 items-center justify-center overflow-hidden rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-muted))]">
            {logoPreview ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={logoPreview} alt="Form logo" className="size-16 object-contain" />
            ) : (
              <ImagePlus className="size-5 text-[hsl(var(--e-text-faint))]" />
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <label className="inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-[var(--e-radius)] border border-[hsl(var(--e-border-strong))] bg-[hsl(var(--e-surface))] px-3 text-[0.75rem] text-[hsl(var(--e-foreground))] transition-colors hover:bg-[hsl(var(--e-muted))]">
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
              <EButton
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => patch({ logoKey: undefined, logoUrl: undefined })}
              >
                <Trash2 className="size-4 text-[hsl(var(--e-danger))]" />
                Remove
              </EButton>
            )}
          </div>
        </div>
        <EInput
          value={t.logoUrl ?? ""}
          onChange={(e) => patch({ logoUrl: e.target.value || undefined, logoKey: undefined })}
          placeholder="…or paste a logo image URL"
          className="mt-2 text-[0.75rem]"
        />
      </EField>

      <div className="grid gap-4 sm:grid-cols-2">
        <EField label="Heading font">
          <ESelect
            value={t.headingFont || ""}
            onChange={(e) => patch({ headingFont: e.target.value || undefined })}
          >
            {FONT_OPTIONS.map((f) => (
              <option key={f.label} value={f.value}>
                {f.label}
              </option>
            ))}
          </ESelect>
        </EField>
        <EField label="Body font">
          <ESelect value={t.bodyFont || ""} onChange={(e) => patch({ bodyFont: e.target.value || undefined })}>
            {FONT_OPTIONS.map((f) => (
              <option key={f.label} value={f.value}>
                {f.label}
              </option>
            ))}
          </ESelect>
        </EField>
      </div>

      <div className="flex items-center justify-between rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] p-3">
        <div>
          <p className="text-[0.8125rem] font-[550] text-[hsl(var(--e-foreground))]">Divider lines between sections</p>
          <p className="text-[0.75rem] text-[hsl(var(--e-text-faint))]">Draws a line under each section heading.</p>
        </div>
        <ESwitch checked={Boolean(t.showDividers)} onCheckedChange={(v) => patch({ showDividers: v || undefined })} />
      </div>

      {theme ? (
        <EButton type="button" variant="ghost" size="sm" onClick={() => onChange(undefined)}>
          Reset theme to default
        </EButton>
      ) : null}
    </div>
  );
}
