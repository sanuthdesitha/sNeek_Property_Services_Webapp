import { cn } from "@/lib/utils";

/**
 * EstateLoader — the shared v2 loading state.
 *
 * A minimal geometric mark in the Estate design language: a champagne arc
 * drawing itself around a breathing emerald diamond, with the serif "sNeek"
 * wordmark shimmering beneath on the full-page variant. Pure CSS/SVG (styles
 * live in app/v2/estate.css under "EstateLoader"); honours
 * prefers-reduced-motion by collapsing to a subtle fade. Uses hsl(var(--e-*))
 * tokens throughout, so it reads correctly on light and Obsidian surfaces —
 * render it inside the [data-skin="estate"] scope (all of app/v2 is).
 *
 * No hooks, so it works directly in server components (route loading.tsx).
 *
 * Variants:
 *   size="page"   (default) — full-surface centered loader with wordmark.
 *   size="inline" — small arc + visible label for in-card fetch states.
 */
export interface EstateLoaderProps {
  /** "page" = full-surface centered loader; "inline" = small in-flow arc. */
  size?: "page" | "inline";
  /** Screen-reader label (page) / visible label (inline). Default "Loading". */
  label?: string;
  /** Show the serif wordmark under the mark (page variant only). */
  showWordmark?: boolean;
  className?: string;
}

const MARK_PX = { page: 56, inline: 18 } as const;

export function EstateLoader({
  size = "page",
  label = "Loading",
  showWordmark,
  className,
}: EstateLoaderProps) {
  const inline = size === "inline";
  const dim = MARK_PX[size];
  const withWordmark = showWordmark ?? !inline;

  return (
    <div
      role="status"
      aria-live="polite"
      aria-busy="true"
      className={cn("e-loader", inline ? "e-loader--inline" : "e-loader--page", className)}
    >
      <span className="e-loader__mark" style={{ width: dim, height: dim }} aria-hidden="true">
        <svg viewBox="0 0 100 100" className="e-loader__ring">
          <circle className="e-loader__track" cx="50" cy="50" r="45" fill="none" strokeWidth={inline ? 8 : 3.5} />
          <circle
            className="e-loader__arc"
            cx="50"
            cy="50"
            r="45"
            fill="none"
            strokeWidth={inline ? 8 : 3.5}
            strokeLinecap="round"
            strokeDasharray="24 259"
          />
        </svg>
        <span className="e-loader__gem" />
      </span>
      {withWordmark && !inline ? <span className="e-loader__wordmark">sNeek</span> : null}
      {inline ? (
        <span className="e-loader__inline-label">{label}…</span>
      ) : (
        <span className="sr-only">{label}…</span>
      )}
    </div>
  );
}

export default EstateLoader;
