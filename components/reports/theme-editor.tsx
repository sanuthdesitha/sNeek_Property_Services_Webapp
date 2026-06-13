"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "@/hooks/use-toast";

type Section = {
  id: string;
  visible: boolean;
  order: number;
  options?: Record<string, any>;
};

type Layout = {
  sections: Section[];
  photoSize: "small" | "medium" | "large" | "hero";
  density: "compact" | "default" | "comfortable";
  template?: "classic" | "luxury";
};

type Theme = {
  id: string;
  name: string;
  kind: string;
  isDefault: boolean;
  layout: Layout;
  logoUrl: string | null;
  primaryColorHsl: string | null;
  accentColorHsl: string | null;
  titleTemplate: string | null;
  footerHtml: string | null;
};

const SECTION_LABELS: Record<string, string> = {
  header: "Header (logo + title)",
  summary: "Job summary",
  "task-checklist": "Task checklist + admin tasks",
  "qa-summary": "Quality inspection summary",
  "before-after-gallery": "Photo gallery",
  supplies: "Supplies / inventory",
  signature: "Signature block",
  footer: "Footer",
};

const PHOTO_SIZES: Array<Layout["photoSize"]> = ["small", "medium", "large", "hero"];
const DENSITIES: Array<Layout["density"]> = ["compact", "default", "comfortable"];
const TEMPLATE_STYLES: Array<NonNullable<Layout["template"]>> = ["classic", "luxury"];

export function ThemeEditor({ initial }: { initial: Theme }) {
  const router = useRouter();
  const [theme, setTheme] = useState<Theme>(initial);
  const [saving, setSaving] = useState(false);
  const [settingDefault, setSettingDefault] = useState(false);

  function updateLayout(patch: Partial<Layout>) {
    setTheme((prev) => ({ ...prev, layout: { ...prev.layout, ...patch } }));
  }

  function toggleSection(id: string, visible: boolean) {
    const sections = theme.layout.sections.map((s) => (s.id === id ? { ...s, visible } : s));
    updateLayout({ sections });
  }

  async function save() {
    setSaving(true);
    const res = await fetch(`/api/admin/report-themes/${theme.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: theme.name,
        layout: theme.layout,
        logoUrl: theme.logoUrl,
        primaryColorHsl: theme.primaryColorHsl,
        accentColorHsl: theme.accentColorHsl,
        titleTemplate: theme.titleTemplate,
        footerHtml: theme.footerHtml,
      }),
    });
    setSaving(false);
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      toast({ title: "Save failed", description: body.error ?? "Try again", variant: "destructive" });
      return;
    }
    toast({ title: "Theme saved" });
    router.refresh();
  }

  async function setAsDefault() {
    setSettingDefault(true);
    const res = await fetch(`/api/admin/report-themes/${theme.id}/set-default`, { method: "POST" });
    setSettingDefault(false);
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      toast({ title: "Could not set default", description: body.error ?? "Try again", variant: "destructive" });
      return;
    }
    setTheme((prev) => ({ ...prev, isDefault: true }));
    toast({ title: "Set as default" });
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardContent className="space-y-4 p-6">
          <div className="space-y-2">
            <Label htmlFor="name">Name</Label>
            <Input
              id="name"
              value={theme.name}
              onChange={(e) => setTheme((prev) => ({ ...prev, name: e.target.value }))}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="titleTemplate">Title template</Label>
            <Input
              id="titleTemplate"
              value={theme.titleTemplate ?? ""}
              onChange={(e) => setTheme((prev) => ({ ...prev, titleTemplate: e.target.value }))}
              placeholder="Job Report — {{job.jobNumber}}"
            />
            <p className="text-xs text-muted-foreground">
              Supports {"{{job.jobNumber}}"} and {"{{property.name}}"}.
            </p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="logoUrl">Logo URL</Label>
            <Input
              id="logoUrl"
              value={theme.logoUrl ?? ""}
              onChange={(e) => setTheme((prev) => ({ ...prev, logoUrl: e.target.value }))}
              placeholder="https://..."
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="primaryColor">Primary color (HSL)</Label>
              <Input
                id="primaryColor"
                value={theme.primaryColorHsl ?? ""}
                onChange={(e) => setTheme((prev) => ({ ...prev, primaryColorHsl: e.target.value }))}
                placeholder="200 98% 39%"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="accentColor">Accent color (HSL)</Label>
              <Input
                id="accentColor"
                value={theme.accentColorHsl ?? ""}
                onChange={(e) => setTheme((prev) => ({ ...prev, accentColorHsl: e.target.value }))}
                placeholder="188 78% 30%"
              />
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="space-y-4 p-6">
          <h3 className="text-lg font-semibold">Template style</h3>
          <p className="text-xs text-muted-foreground">
            Classic is the standard report skin. Luxury renders a premium, magazine-grade layout.
          </p>
          <div className="flex flex-wrap gap-2">
            {TEMPLATE_STYLES.map((style) => (
              <Button
                key={style}
                type="button"
                size="sm"
                variant={(theme.layout.template ?? "classic") === style ? "default" : "outline"}
                onClick={() => updateLayout({ template: style })}
                className="capitalize"
              >
                {style}
              </Button>
            ))}
          </div>

          <h3 className="text-lg font-semibold mt-4">Photo size</h3>
          <div className="flex flex-wrap gap-2">
            {PHOTO_SIZES.map((size) => (
              <Button
                key={size}
                type="button"
                size="sm"
                variant={theme.layout.photoSize === size ? "default" : "outline"}
                onClick={() => updateLayout({ photoSize: size })}
              >
                {size}
              </Button>
            ))}
          </div>

          <h3 className="text-lg font-semibold mt-4">Density</h3>
          <div className="flex flex-wrap gap-2">
            {DENSITIES.map((d) => (
              <Button
                key={d}
                type="button"
                size="sm"
                variant={theme.layout.density === d ? "default" : "outline"}
                onClick={() => updateLayout({ density: d })}
              >
                {d}
              </Button>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="space-y-3 p-6">
          <h3 className="text-lg font-semibold">Sections</h3>
          <p className="text-xs text-muted-foreground">
            Toggle visibility for each section in the rendered report.
          </p>
          <div className="space-y-2">
            {theme.layout.sections.map((s) => (
              <label key={s.id} className="flex items-center gap-3 text-sm">
                <Checkbox
                  checked={s.visible}
                  onCheckedChange={(value) => toggleSection(s.id, value === true)}
                />
                <span>{SECTION_LABELS[s.id] ?? s.id}</span>
              </label>
            ))}
          </div>
        </CardContent>
      </Card>

      <div className="flex items-center justify-between gap-2">
        <div>
          {theme.isDefault ? (
            <p className="text-sm text-muted-foreground">This is the default theme.</p>
          ) : (
            <Button variant="outline" onClick={setAsDefault} disabled={settingDefault}>
              {settingDefault ? "Setting..." : "Set as default"}
            </Button>
          )}
        </div>
        <Button onClick={save} disabled={saving}>
          {saving ? "Saving..." : "Save changes"}
        </Button>
      </div>
    </div>
  );
}
