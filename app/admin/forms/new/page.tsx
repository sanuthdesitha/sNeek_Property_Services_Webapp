"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { FileText, LayoutTemplate, Sparkles } from "lucide-react";
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import { ALL_SEED_TEMPLATES } from "@/lib/forms/seed-templates";

/**
 * [FormKind, display label, default JobType serviceType]
 *
 * JobType values must match the prisma enum in schema.prisma:
 *   AIRBNB_TURNOVER | DEEP_CLEAN | END_OF_LEASE | GENERAL_CLEAN |
 *   POST_CONSTRUCTION | PRESSURE_WASH | WINDOW_CLEAN | LAWN_MOWING |
 *   SPECIAL_CLEAN | COMMERCIAL_RECURRING | CARPET_STEAM_CLEAN |
 *   MOLD_TREATMENT | UPHOLSTERY_CLEANING | TILE_GROUT_CLEANING |
 *   GUTTER_CLEANING | SPRING_CLEANING
 */
const KINDS: ReadonlyArray<readonly [string, string, string]> = [
  ["AIRBNB_TURNOVER", "Airbnb Turnover", "AIRBNB_TURNOVER"],
  ["END_OF_LEASE", "End of Lease", "END_OF_LEASE"],
  ["DEEP_CLEAN", "Deep Clean", "DEEP_CLEAN"],
  ["REGULAR_MAINTENANCE", "Regular Maintenance", "GENERAL_CLEAN"],
  ["POST_CONSTRUCTION", "Post-Construction", "POST_CONSTRUCTION"],
  ["WINDOW", "Window / Glass", "WINDOW_CLEAN"],
  ["CARPET", "Carpet / Steam", "CARPET_STEAM_CLEAN"],
  ["COMMERCIAL", "Commercial / Office", "COMMERCIAL_RECURRING"],
  ["MOVE_IN", "Move-in / Move-out", "GENERAL_CLEAN"],
  ["OVEN", "Oven / Appliance", "SPECIAL_CLEAN"],
  ["CUSTOM", "Custom", "GENERAL_CLEAN"],
];

type SeedTemplate = (typeof ALL_SEED_TEMPLATES)[number];

function sectionCount(t: SeedTemplate) {
  return t.schema.sections.length;
}
function fieldCount(t: SeedTemplate) {
  return t.schema.sections.reduce((sum, s) => sum + s.fields.length, 0);
}

export default function NewFormPage() {
  const [name, setName] = React.useState("");
  const [kind, setKind] = React.useState<string>("CUSTOM");
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const router = useRouter();

  async function createTemplate(payload: {
    name: string;
    kind: string;
    serviceType: string;
    schema?: unknown;
  }) {
    setError(null);
    setSaving(true);
    try {
      const res = await fetch("/api/admin/form-templates", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `Create failed (${res.status})`);
      }
      const body = await res.json();
      // POST returns the bare template (no { template } wrapper) for V1 path.
      const id = body?.id ?? body?.template?.id;
      if (!id) throw new Error("Server returned no template id");
      router.push(`/admin/forms/${id}/edit`);
    } catch (err: any) {
      setError(err?.message ?? "Create failed");
    } finally {
      setSaving(false);
    }
  }

  async function handleCreateBlank() {
    const serviceType = KINDS.find((k) => k[0] === kind)?.[2] ?? "GENERAL_CLEAN";
    await createTemplate({ name: name.trim(), kind, serviceType });
  }

  async function handleStartFromTemplate(t: SeedTemplate) {
    await createTemplate({
      name: name.trim() || t.name.replace(/\s+v\d+$/i, ""),
      kind: t.kind,
      serviceType: t.serviceType,
      schema: t.schema,
    });
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileText className="size-5" /> New form template
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1">
              <Label htmlFor="name">Name (optional)</Label>
              <Input
                id="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Premium turnover"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="kind">Job kind (for a blank template)</Label>
              <Select value={kind} onValueChange={setKind}>
                <SelectTrigger id="kind">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {KINDS.map(([v, label]) => (
                    <SelectItem key={v} value={v}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          {error && <p className="text-xs text-destructive">{error}</p>}
        </CardContent>
        <CardFooter>
          <Button onClick={handleCreateBlank} disabled={saving} variant="outline">
            {saving ? "Creating…" : "Create blank template"}
          </Button>
        </CardFooter>
      </Card>

      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <LayoutTemplate className="size-4 text-muted-foreground" />
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Start from a ready-made template
          </h2>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {ALL_SEED_TEMPLATES.map((t) => {
            const accent = t.schema.theme?.accentColor;
            return (
              <Card key={`${t.kind}-${t.version}`} className="flex flex-col rounded-xl">
                <CardHeader className="pb-2">
                  <div className="flex items-start justify-between gap-2">
                    <CardTitle className="text-sm leading-snug">
                      {t.name.replace(/\s+v\d+$/i, "")}
                    </CardTitle>
                    <span
                      className="mt-0.5 size-4 shrink-0 rounded-full border"
                      style={accent ? { backgroundColor: accent } : undefined}
                      aria-hidden
                    />
                  </div>
                </CardHeader>
                <CardContent className="flex-1 pb-2">
                  <p className="text-xs tabular-nums text-muted-foreground">
                    {t.serviceType.replace(/_/g, " ")} · {sectionCount(t)} sections ·{" "}
                    {fieldCount(t)} fields
                  </p>
                </CardContent>
                <CardFooter>
                  <Button
                    size="sm"
                    className="w-full"
                    disabled={saving}
                    onClick={() => handleStartFromTemplate(t)}
                  >
                    <Sparkles className="mr-1.5 size-4" />
                    Use this template
                  </Button>
                </CardFooter>
              </Card>
            );
          })}
        </div>
      </div>
    </div>
  );
}
