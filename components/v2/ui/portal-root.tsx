"use client";

/**
 * A portal that keeps the Estate skin.
 *
 * Every `--e-*` token is defined under `[data-skin="estate"]` (app/v2/estate.css),
 * and that attribute sits on a wrapper div inside each portal layout — not on
 * <html> or <body>. So anything rendered with `createPortal(..., document.body)`
 * lands OUTSIDE the scope that defines its colours: `hsl(var(--e-surface))`
 * resolves to nothing and the panel comes out transparent, along with every
 * border and text colour in it.
 *
 * That is what made the final check-up acknowledgement dialog see-through. It
 * was not a background someone forgot — it was a background that could not
 * resolve where the element had been moved to.
 *
 * Re-declaring the attributes on the portal container fixes every token at once
 * and keeps the fix in one place, so the next dialog that needs a portal does
 * not quietly inherit the bug.
 */

import * as React from "react";
import { createPortal } from "react-dom";

/** The accents estate.css defines; anything else falls back to the base skin. */
export type PortalAccent =
  | "admin"
  | "client"
  | "cleaner"
  | "laundry"
  | "qa"
  | "maintenance"
  | "public";

export function EstatePortal({
  children,
  accent,
}: {
  children: React.ReactNode;
  /**
   * Defaults to whatever the surrounding layout set, read from the DOM — a
   * dialog opened in the cleaner portal should not have to be told it is in
   * the cleaner portal.
   */
  accent?: PortalAccent;
}) {
  // document.body does not exist during the server render, and reading the
  // surrounding accent needs a mounted tree.
  const [mounted, setMounted] = React.useState(false);
  const [resolvedAccent, setResolvedAccent] = React.useState<string | null>(null);

  React.useEffect(() => {
    setMounted(true);
    if (accent) {
      setResolvedAccent(accent);
      return;
    }
    const skinned = document.querySelector<HTMLElement>(
      "[data-skin='estate'][data-portal-accent]"
    );
    setResolvedAccent(skinned?.getAttribute("data-portal-accent") ?? null);
  }, [accent]);

  if (!mounted) return null;

  return createPortal(
    <div
      data-skin="estate"
      {...(resolvedAccent ? { "data-portal-accent": resolvedAccent } : {})}
      // The wrapper must not become a layout box of its own: the children are
      // `fixed inset-0` and position against the viewport, which a wrapper with
      // its own size or transform would break.
      style={{ display: "contents" }}
    >
      {children}
    </div>,
    document.body
  );
}
