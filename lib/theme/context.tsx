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
    document.documentElement.classList.toggle("dark", resolved === "dark");
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
