"use client";

/**
 * A lazy disclosure for a stage's secondary tool (an editor, a full list).
 * Its content mounts on first open and stays mounted when collapsed, so a
 * draft survives closing it; the job page remounts on navigation to another
 * job, which resets it. It opens itself when the URL hash names it (e.g. the
 * rail's "Edit billing" link, or an old `?tab=money` link).
 */
import { useEffect, useId, useState, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

export type JobDisclosureProps = {
  /** Element id; a URL hash equal to it opens the disclosure. */
  id: string;
  label: string;
  /** One line on what the tool does (and does not change). */
  description?: string;
  defaultOpen?: boolean;
  children: ReactNode;
  className?: string;
};

export function JobDisclosure({ id, label, description, defaultOpen = false, children, className }: JobDisclosureProps) {
  const [open, setOpen] = useState(defaultOpen);
  const [mounted, setMounted] = useState(defaultOpen);
  const panelId = useId();

  useEffect(() => {
    const openFromHash = () => {
      if (window.location.hash === `#${id}`) {
        setOpen(true);
        setMounted(true);
      }
    };
    openFromHash();
    window.addEventListener("hashchange", openFromHash);
    return () => window.removeEventListener("hashchange", openFromHash);
  }, [id]);

  function toggle() {
    setOpen((value) => !value);
    setMounted(true);
  }

  return (
    <div id={id} className={cn("scroll-mt-24 rounded-[var(--e-radius)] border border-[hsl(var(--e-border))]", className)}>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={toggle}
        className="flex min-h-11 w-full items-center justify-between gap-3 px-3 py-2 text-left text-[0.8125rem] font-[550] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--e-ring))]"
      >
        <span className="min-w-0">
          {label}
          {description ? <span className="block text-[0.75rem] font-[400] text-[hsl(var(--e-muted-foreground))]">{description}</span> : null}
        </span>
        <ChevronDown aria-hidden className={cn("h-4 w-4 shrink-0 transition-transform", open && "rotate-180")} />
      </button>
      <div id={panelId} hidden={!open} className="border-t border-[hsl(var(--e-border))] p-3">
        {mounted ? children : null}
      </div>
    </div>
  );
}
