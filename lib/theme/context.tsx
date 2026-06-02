"use client";
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

export type ThemePreference = "light" | "dark" | "system";
export type ResolvedTheme = "light" | "dark";

interface ThemeContextValue {
  preference: ThemePreference;
  resolved: ResolvedTheme;
  setPreference: (p: ThemePreference) => void;
}

const ThemeContext = createContext<ThemeContextValue>({
  preference: "system",
  resolved: "light",
  setPreference: () => {},
});

export const useTheme = () => useContext(ThemeContext);

function resolveSystemTheme(): ResolvedTheme {
  if (typeof window === "undefined") return "light";
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export function ThemeProvider({
  initial = "system",
  onChange,
  children,
}: {
  initial?: ThemePreference;
  onChange?: (p: ThemePreference) => void;
  children: ReactNode;
}) {
  const [preference, setPreferenceState] = useState<ThemePreference>(initial);
  const [systemResolved, setSystemResolved] = useState<ResolvedTheme>("light");

  useEffect(() => {
    setSystemResolved(resolveSystemTheme());
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChangeSys = () => setSystemResolved(mq.matches ? "dark" : "light");
    mq.addEventListener("change", onChangeSys);
    return () => mq.removeEventListener("change", onChangeSys);
  }, []);

  const resolved: ResolvedTheme = preference === "system" ? systemResolved : preference;

  useEffect(() => {
    if (typeof document === "undefined") return;

    // Detect public marketing pages — they ALWAYS render light regardless of
    // user preference. Public surface styling assumes a light palette and
    // doesn't have dark-mode tokens for many components.
    const pathname = typeof window !== "undefined" ? window.location.pathname : "";
    const isPortalPath =
      pathname.startsWith("/admin") ||
      pathname.startsWith("/cleaner") ||
      pathname.startsWith("/client") ||
      pathname.startsWith("/laundry") ||
      pathname.startsWith("/qa") ||
      pathname.startsWith("/dev");

    if (isPortalPath) {
      document.documentElement.classList.toggle("dark", resolved === "dark");
    } else if (document.documentElement.hasAttribute("data-public-theme-managed")) {
      // Public marketing pages run their own light/dark toggle
      // (PublicThemeProvider). Leave the `dark` class to them.
    } else {
      // Other non-portal pages (login, register, rate, etc.) stay light.
      document.documentElement.classList.remove("dark");
    }

    // Keep all `data-portal-theme` wrappers in sync with the resolved theme so
    // CSS selectors scoped to `[data-portal-theme="dark|light"]` pick up the
    // current theme without a reload. We deliberately skip elements explicitly
    // marked `data-portal-theme="public"` — the public marketing surface keeps
    // its warm palette.
    const wrappers = document.querySelectorAll<HTMLElement>("[data-portal-theme]");
    wrappers.forEach((el) => {
      if (el.getAttribute("data-portal-theme") === "public") return;
      el.setAttribute("data-portal-theme", resolved);
    });
  }, [resolved]);

  const setPreference = (p: ThemePreference) => {
    setPreferenceState(p);
    onChange?.(p);
  };

  return (
    <ThemeContext.Provider value={{ preference, resolved, setPreference }}>
      {children}
    </ThemeContext.Provider>
  );
}
