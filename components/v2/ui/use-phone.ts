"use client";

/**
 * True while the viewport is a phone (below 640px). Starts false so the server
 * render and the first client render agree (desktop markup); components that
 * swap markup on a phone must therefore also hide the desktop variant with
 * `max-sm:hidden` so a phone never flashes it before this effect runs.
 */
import * as React from "react";
import { PHONE_QUERY } from "./phone";

export function useIsPhone(): boolean {
  const [phone, setPhone] = React.useState(false);
  React.useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    const query = window.matchMedia(PHONE_QUERY);
    const update = () => setPhone(Boolean(query.matches));
    update();
    query.addEventListener?.("change", update);
    return () => query.removeEventListener?.("change", update);
  }, []);
  return phone;
}
