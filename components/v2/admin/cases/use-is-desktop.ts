"use client";

import * as React from "react";

/** True from the `lg` breakpoint (1024px), where the inbox shows all four columns. */
export function useIsDesktop(query = "(min-width: 1024px)"): boolean {
  const [matches, setMatches] = React.useState(true);
  React.useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    const media = window.matchMedia(query);
    const update = () => setMatches(media.matches);
    update();
    media.addEventListener?.("change", update);
    return () => media.removeEventListener?.("change", update);
  }, [query]);
  return matches;
}
