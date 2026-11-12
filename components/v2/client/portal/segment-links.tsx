/**
 * Link-based segmented control for client screens (board: "Waiting 2 | History",
 * "Invoices | Unbilled | Rates", property tabs). Every segment is a deep link
 * that survives a reload; 44px targets; the row scrolls inside itself on a
 * narrow phone instead of widening the page.
 *
 * No "use client": server pages render it directly.
 */
import Link from "next/link";
import { cn } from "@/lib/utils";

export interface SegmentLink {
  key: string;
  label: string;
  href: string;
  /** A real count from the server; omitted when unknown. */
  count?: number;
}

export function SegmentLinks({
  links,
  activeKey,
  label,
  variant = "segmented",
  className,
}: {
  links: readonly SegmentLink[];
  activeKey: string;
  /** Accessible name of the row, e.g. "Money sections". */
  label: string;
  /** "segmented" fills the row (board seg); "chips" scrolls sideways (property tabs). */
  variant?: "segmented" | "chips";
  className?: string;
}) {
  const chips = variant === "chips";
  return (
    <nav aria-label={label} className={cn("-mx-1 overflow-x-auto px-1 pb-1 [scrollbar-width:none]", className)}>
      <ul
        className={cn(
          "inline-flex gap-1",
          chips ? "" : "min-w-full rounded-[var(--e-radius-lg)] bg-[hsl(var(--e-muted))] p-1",
        )}
      >
        {links.map((link) => {
          const active = link.key === activeKey;
          return (
            <li key={link.key} className={chips ? "flex" : "flex flex-1"}>
              <Link
                href={link.href}
                scroll={false}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "inline-flex min-h-11 shrink-0 items-center justify-center gap-1.5 whitespace-nowrap px-3 text-[0.8125rem] transition-colors focus-visible:outline focus-visible:outline-2",
                  chips
                    ? cn(
                        "rounded-[var(--e-radius-pill)] border",
                        active
                          ? "border-[hsl(var(--e-accent-portal))] bg-[hsl(var(--e-accent-portal))] font-[600] text-[hsl(var(--e-accent-portal-foreground))]"
                          : "border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface))] text-[hsl(var(--e-text-secondary))] hover:bg-[hsl(var(--e-muted))]",
                      )
                    : cn(
                        "flex-1 rounded-[var(--e-radius)]",
                        active
                          ? "bg-[hsl(var(--e-surface))] font-[600] text-[hsl(var(--e-foreground))] shadow-[var(--e-elevation-1)]"
                          : "text-[hsl(var(--e-text-secondary))] hover:text-[hsl(var(--e-foreground))]",
                      ),
                )}
              >
                {link.label}
                {typeof link.count === "number" ? (
                  <span className="e-tnum text-[0.75rem]">{link.count}</span>
                ) : null}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
