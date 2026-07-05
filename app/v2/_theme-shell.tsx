"use client";

import { ThemeProvider, type ThemePreference } from "@/lib/theme/context";

/**
 * Client wrapper that mounts the shared ThemeProvider for the whole v2 tree so
 * the Estate skin honours the signed-in user's light/dark/system preference
 * (persisted via /api/me/preferences from the profile pages). ThemeProvider
 * toggles `.dark` on <html>, which drives estate.css's `.dark [data-skin=estate]`
 * palette. `initial` is server-fed so the choice survives reloads.
 */
export function V2ThemeShell({
  initial,
  children,
}: {
  initial: ThemePreference;
  children: React.ReactNode;
}) {
  return <ThemeProvider initial={initial}>{children}</ThemeProvider>;
}
