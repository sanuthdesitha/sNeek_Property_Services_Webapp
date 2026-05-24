"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
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

export default function NewFormPage() {
  const [name, setName] = React.useState("");
  const [kind, setKind] = React.useState<string>("CUSTOM");
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const router = useRouter();

  async function handleCreate() {
    setError(null);
    setSaving(true);
    const serviceType =
      KINDS.find((k) => k[0] === kind)?.[2] ?? "GENERAL_CLEAN";
    try {
      const res = await fetch("/api/admin/form-templates", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: name.trim(), kind, serviceType }),
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

  return (
    <div className="mx-auto max-w-md p-6">
      <Card>
        <CardHeader>
          <CardTitle>New form template</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1">
            <Label htmlFor="name">Name</Label>
            <Input
              id="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Premium turnover"
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="kind">Job kind</Label>
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
          {error && <p className="text-xs text-destructive">{error}</p>}
        </CardContent>
        <CardFooter>
          <Button
            onClick={handleCreate}
            disabled={!name.trim() || saving}
            className="w-full"
          >
            {saving ? "Creating…" : "Create template"}
          </Button>
        </CardFooter>
      </Card>
    </div>
  );
}
