"use client";

import { useEffect } from "react";

/**
 * Force every public marketing page to render in light theme regardless of
 * the user's saved preference or system color scheme.
 *
 * The public site styling assumes a light surface palette — applying the
 * `dark` class to documentElement makes text unreadable. We strip the class
 * on mount and watch for ThemeProvider re-adding it (race during navigation
 * between admin → public).
 */
export function ForceLightTheme() {
  useEffect(() => {
    const root = document.documentElement;
    root.classList.remove("dark");
    root.setAttribute("data-portal-theme", "public");

    const observer = new MutationObserver(() => {
      if (root.classList.contains("dark")) {
        root.classList.remove("dark");
      }
      if (root.getAttribute("data-portal-theme") !== "public") {
        root.setAttribute("data-portal-theme", "public");
      }
    });
    observer.observe(root, {
      attributes: true,
      attributeFilter: ["class", "data-portal-theme"],
    });

    return () => {
      observer.disconnect();
    };
  }, []);

  return null;
}
