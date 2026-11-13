"use client";

/**
 * Phone-only page furniture (board "Admin phone", 2026-11). Neither renders
 * anything from 640px up, so a page can add them without changing desktop.
 *
 * EPhoneActionBar: the page's ONE primary action (and an optional secondary)
 * in thumb reach, docked above the portal's tab bar. It renders only once the
 * viewport is known to be a phone, so the page keeps its desktop button and
 * hides it below 640px with `max-sm:hidden`; the action is never in the
 * document twice at any width.
 *
 *   <EButton asChild className="max-sm:hidden"><Link href="/v2/admin/jobs/new">New job</Link></EButton>
 *   <EPhoneActionBar label="Jobs actions" primary={<EButton asChild><Link href="/v2/admin/jobs/new">New job</Link></EButton>} />
 *
 * ESectionSwitcher: sticky horizontal chips that jump to the sections of a
 * long page (`<section id>`), marking the one in view. A deliberate carousel:
 * it scrolls sideways on its own, the page never does.
 */
import * as React from "react";
import { cn } from "@/lib/utils";
import { E_CHIP_CLASS, E_CHIP_ON_CLASS } from "./filter-chips";
import { useIsPhone } from "./use-phone";

export type EPhoneActionBarProps = {
  /** Accessible name of the bar, e.g. "Jobs actions". */
  label: string;
  /** The primary action (an EButton, or EButton asChild around a Link). */
  primary: React.ReactNode;
  /** An optional secondary action, drawn before the primary. */
  secondary?: React.ReactNode;
  /** Hide while something else owns the bottom of the screen (a bulk bar). */
  hidden?: boolean;
};

export function EPhoneActionBar({ label, primary, secondary, hidden = false }: EPhoneActionBarProps) {
  const phone = useIsPhone();
  if (!phone || hidden) return null;
  return (
    <>
      {/* Keeps the end of the page clear of the docked bar. */}
      <div aria-hidden className="h-16 sm:hidden" />
      <div
        role="region"
        aria-label={label}
        data-phone-action-bar=""
        className="fixed inset-x-0 bottom-[calc(env(safe-area-inset-bottom)+3.5rem)] z-30 flex items-center gap-2 border-t border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface)/0.97)] px-4 py-2.5 backdrop-blur sm:hidden [&>*:last-child]:flex-1"
      >
        {secondary}
        {primary}
      </div>
    </>
  );
}

export type ESectionLink = { id: string; label: string };

export type ESectionSwitcherProps = {
  /** e.g. "Invoice sections". */
  label: string;
  sections: ESectionLink[];
  /** Show from 640px up too. Default: phones only. */
  everywhere?: boolean;
  className?: string;
};

export function ESectionSwitcher({ label, sections, everywhere = false, className }: ESectionSwitcherProps) {
  const [current, setCurrent] = React.useState(sections[0]?.id ?? "");
  const ids = sections.map((section) => section.id).join("|");

  React.useEffect(() => {
    if (typeof IntersectionObserver === "undefined") return;
    const targets = ids.split("|").map((id) => document.getElementById(id)).filter((element): element is HTMLElement => element !== null);
    if (targets.length === 0) return;
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries.filter((entry) => entry.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (visible[0]) setCurrent(visible[0].target.id);
      },
      { rootMargin: "-120px 0px -55% 0px" },
    );
    targets.forEach((target) => observer.observe(target));
    return () => observer.disconnect();
  }, [ids]);

  function jump(id: string) {
    setCurrent(id);
    const target = document.getElementById(id);
    target?.scrollIntoView({ behavior: "smooth", block: "start" });
    // Move focus for keyboard and screen-reader users without a second scroll.
    if (target) {
      if (!target.hasAttribute("tabindex")) target.setAttribute("tabindex", "-1");
      target.focus({ preventScroll: true });
    }
  }

  return (
    <nav
      aria-label={label}
      className={cn(
        "sticky top-16 z-20 -mx-4 overflow-x-auto border-b border-[hsl(var(--e-border))] bg-[hsl(var(--e-background)/0.95)] px-4 py-2 backdrop-blur [scrollbar-width:none]",
        !everywhere && "sm:hidden",
        className,
      )}
    >
      <ul className="flex w-max gap-1.5">
        {sections.map((section) => (
          <li key={section.id}>
            <a
              href={`#${section.id}`}
              aria-current={current === section.id ? "location" : undefined}
              onClick={(event) => {
                event.preventDefault();
                jump(section.id);
              }}
              className={cn(E_CHIP_CLASS, "no-underline", current === section.id && E_CHIP_ON_CLASS)}
            >
              {section.label}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}
