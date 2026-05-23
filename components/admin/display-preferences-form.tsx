"use client";
import * as React from "react";

type Density = "COMPACT" | "DEFAULT" | "COMFORTABLE";
type Theme = "LIGHT" | "DARK" | "SYSTEM";

export function DisplayPreferencesForm({
  initialDensity,
  initialTheme,
}: {
  initialDensity: Density;
  initialTheme: Theme;
}) {
  const [density, setDensity] = React.useState<Density>(initialDensity);
  const [theme, setTheme] = React.useState<Theme>(initialTheme);
  const [status, setStatus] = React.useState<"idle" | "saving" | "saved" | "error">("idle");

  async function save(payload: Partial<{ uiDensity: Density; themePreference: Theme }>) {
    setStatus("saving");
    try {
      const res = await fetch("/api/me/preferences", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error("Save failed");
      setStatus("saved");
      setTimeout(() => setStatus("idle"), 1500);
    } catch {
      setStatus("error");
    }
  }

  return (
    <section className="space-y-4 rounded-lg border border-border bg-surface p-6">
      <header>
        <h3 className="text-lg font-semibold">Display Preferences</h3>
        <p className="text-sm text-muted-foreground">Choose how the dashboard looks for you.</p>
      </header>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <div className="space-y-1">
          <label className="text-sm font-medium" htmlFor="density">
            Density
          </label>
          <select
            id="density"
            value={density}
            onChange={(e) => {
              const v = e.target.value as Density;
              setDensity(v);
              save({ uiDensity: v });
            }}
            className="h-10 w-full rounded border border-border bg-surface px-3 text-sm text-foreground"
          >
            <option value="COMPACT">Compact</option>
            <option value="DEFAULT">Default</option>
            <option value="COMFORTABLE">Comfortable</option>
          </select>
        </div>
        <div className="space-y-1">
          <label className="text-sm font-medium" htmlFor="theme">
            Theme
          </label>
          <select
            id="theme"
            value={theme}
            onChange={(e) => {
              const v = e.target.value as Theme;
              setTheme(v);
              save({ themePreference: v });
            }}
            className="h-10 w-full rounded border border-border bg-surface px-3 text-sm text-foreground"
          >
            <option value="LIGHT">Light</option>
            <option value="DARK">Dark</option>
            <option value="SYSTEM">Match system</option>
          </select>
        </div>
      </div>
      <p
        className="text-xs text-muted-foreground"
        aria-live="polite"
        data-testid="display-prefs-status"
      >
        {status === "saving" && "Saving…"}
        {status === "saved" && "Saved."}
        {status === "error" && "Save failed — please retry."}
      </p>
    </section>
  );
}
