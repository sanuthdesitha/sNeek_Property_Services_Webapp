"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";

type Density = "COMPACT" | "DEFAULT" | "COMFORTABLE";
type Theme = "LIGHT" | "DARK" | "SYSTEM";

interface DisplayPreferencesSectionProps {
  initialDensity?: Density;
  initialTheme?: Theme;
}

export function DisplayPreferencesSection({
  initialDensity = "DEFAULT",
  initialTheme = "SYSTEM",
}: DisplayPreferencesSectionProps) {
  const [density, setDensity] = React.useState<Density>(initialDensity);
  const [theme, setTheme] = React.useState<Theme>(initialTheme);
  const [saving, setSaving] = React.useState(false);
  const router = useRouter();

  async function update(payload: { uiDensity?: Density; themePreference?: Theme }) {
    setSaving(true);
    try {
      await fetch("/api/me/preferences", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      // Apply theme change immediately on document.documentElement
      if (payload.themePreference) {
        const resolved =
          payload.themePreference === "SYSTEM"
            ? window.matchMedia("(prefers-color-scheme: dark)").matches
              ? "DARK"
              : "LIGHT"
            : payload.themePreference;
        document.documentElement.classList.toggle("dark", resolved === "DARK");
      }
      router.refresh();
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Display Preferences</CardTitle>
        <CardDescription>Choose how the dashboard looks for you.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div className="space-y-1">
            <Label htmlFor="theme">Theme</Label>
            <Select
              value={theme}
              onValueChange={(v: Theme) => {
                setTheme(v);
                update({ themePreference: v });
              }}
              disabled={saving}
            >
              <SelectTrigger id="theme">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="LIGHT">Light</SelectItem>
                <SelectItem value="DARK">Dark</SelectItem>
                <SelectItem value="SYSTEM">Match system</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="density">Density</Label>
            <Select
              value={density}
              onValueChange={(v: Density) => {
                setDensity(v);
                update({ uiDensity: v });
              }}
              disabled={saving}
            >
              <SelectTrigger id="density">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="COMPACT">Compact</SelectItem>
                <SelectItem value="DEFAULT">Default</SelectItem>
                <SelectItem value="COMFORTABLE">Comfortable</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
