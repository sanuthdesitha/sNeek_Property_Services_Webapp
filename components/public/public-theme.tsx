"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { Moon, Sun } from "lucide-react";

// Public marketing pages default to LIGHT but let visitors switch to dark.
// The choice persists per-browser. This provider owns the `dark` class on
// public routes; the global ThemeProvider stands down while it's mounted
// (it sets a data flag the global provider checks — see lib/theme/context.tsx).

type PublicTheme = "light" | "dark";

const STORAGE_KEY = "sneek-public-theme";
const MANAGED_ATTR = "data-public-theme-managed";

interface PublicThemeValue {
  theme: PublicTheme;
  toggle: () => void;
  setTheme: (t: PublicTheme) => void;
}

const PublicThemeContext = createContext<PublicThemeValue>({
  theme: "light",
  toggle: () => {},
  setTheme: () => {},
});

export const usePublicTheme = () => useContext(PublicThemeContext);

function applyTheme(theme: PublicTheme) {
  if (typeof document === "undefined") return;
  document.documentElement.classList.toggle("dark", theme === "dark");
}

export function PublicThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<PublicTheme>("light");

  useEffect(() => {
    const root = document.documentElement;
    root.setAttribute(MANAGED_ATTR, "1");

    let initial: PublicTheme = "light";
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored === "dark" || stored === "light") initial = stored;
    } catch {
      /* ignore */
    }
    setThemeState(initial);
    applyTheme(initial);

    return () => {
      root.removeAttribute(MANAGED_ATTR);
    };
  }, []);

  const setTheme = (next: PublicTheme) => {
    setThemeState(next);
    applyTheme(next);
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      /* ignore */
    }
  };

  const toggle = () => setTheme(theme === "dark" ? "light" : "dark");

  return (
    <PublicThemeContext.Provider value={{ theme, toggle, setTheme }}>
      {children}
    </PublicThemeContext.Provider>
  );
}

export function PublicThemeToggle({ className = "" }: { className?: string }) {
  const { theme, toggle } = usePublicTheme();
  const isDark = theme === "dark";
  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={isDark ? "Switch to light theme" : "Switch to dark theme"}
      title={isDark ? "Switch to light theme" : "Switch to dark theme"}
      className={
        "inline-flex h-9 w-9 items-center justify-center rounded-full border border-border/70 bg-surface-raised/80 text-foreground transition-colors hover:bg-surface-raised " +
        className
      }
    >
      {isDark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
    </button>
  );
}
