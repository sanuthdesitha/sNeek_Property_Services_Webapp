"use client";

/**
 * ESTATE row menu: the "more" menu that holds a row's secondary and
 * destructive actions, leaving one primary action visible on the row.
 *
 * Keyboard: Enter/Space/ArrowDown open it on the first item, ArrowUp on the
 * last; arrows, Home and End move; Escape or Tab closes it and focus returns to
 * the trigger. It renders in a skin-preserving portal with fixed positioning so
 * a table that scrolls inside its own box cannot clip it.
 *
 * Items only START an action. Confirmation, PIN and typed-phrase rules stay in
 * the dialog each action already opens.
 */
import * as React from "react";
import { MoreHorizontal } from "lucide-react";
import { cn } from "@/lib/utils";
import { EstatePortal } from "./portal-root";

export type ERowMenuItem = {
  key: string;
  label: string;
  icon?: React.ReactNode;
  onSelect?: () => void;
  /** Renders a link instead of a button (e.g. open a PDF). */
  href?: string;
  newTab?: boolean;
  danger?: boolean;
  disabled?: boolean;
  /** Short reason shown as the item title when disabled. */
  hint?: string;
  /** Draws a separator above this item. */
  separated?: boolean;
};

export type ERowMenuProps = {
  /** Accessible name of the trigger, e.g. "More actions for INV-0042". */
  label: string;
  items: ERowMenuItem[];
  disabled?: boolean;
  className?: string;
  /**
   * Visible trigger content for a labelled menu button (e.g. "New invoice ▾").
   * Omit for the row's "⋯" button.
   */
  trigger?: React.ReactNode;
};

type MenuPosition = { top: number; left: number; maxHeight: number };
const MENU_WIDTH = 240;
const GAP = 4;

function positionFor(trigger: HTMLElement): MenuPosition {
  const rect = trigger.getBoundingClientRect();
  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;
  const left = Math.max(8, Math.min(rect.right - MENU_WIDTH, viewportWidth - MENU_WIDTH - 8));
  const below = viewportHeight - rect.bottom - GAP - 8;
  const above = rect.top - GAP - 8;
  if (below >= 200 || below >= above) {
    return { top: rect.bottom + GAP, left, maxHeight: Math.max(120, below) };
  }
  const maxHeight = Math.max(120, above);
  return { top: Math.max(8, rect.top - GAP - maxHeight), left, maxHeight };
}

export function ERowMenu({ label, items, disabled = false, className, trigger }: ERowMenuProps) {
  const [open, setOpen] = React.useState(false);
  const [position, setPosition] = React.useState<MenuPosition | null>(null);
  const triggerRef = React.useRef<HTMLButtonElement>(null);
  const menuRef = React.useRef<HTMLDivElement>(null);
  const pendingFocus = React.useRef<"first" | "last">("first");
  const menuId = React.useId();

  const enabledItems = React.useCallback(
    () => Array.from(menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]:not([aria-disabled="true"])') ?? []),
    [],
  );

  const close = React.useCallback((returnFocus: boolean) => {
    setOpen(false);
    if (returnFocus) triggerRef.current?.focus();
  }, []);

  function openMenu(focus: "first" | "last") {
    if (!triggerRef.current) return;
    pendingFocus.current = focus;
    setPosition(positionFor(triggerRef.current));
    setOpen(true);
  }

  // Focus the first (or last) item once the menu is in the DOM.
  React.useEffect(() => {
    if (!open) return;
    // The portal mounts a render later, so retry for a few frames.
    let frame = 0;
    let attempts = 0;
    const focusTarget = () => {
      const list = enabledItems();
      const target = pendingFocus.current === "last" ? list[list.length - 1] : list[0];
      if (target) target.focus();
      else if (attempts++ < 5) frame = window.requestAnimationFrame(focusTarget);
    };
    frame = window.requestAnimationFrame(focusTarget);
    return () => window.cancelAnimationFrame(frame);
  }, [open, enabledItems]);

  // Close on outside pointer, scroll or resize (the anchor would move).
  React.useEffect(() => {
    if (!open) return;
    const onPointer = (event: PointerEvent) => {
      const target = event.target as Node;
      if (menuRef.current?.contains(target) || triggerRef.current?.contains(target)) return;
      close(false);
    };
    const onScroll = (event: Event) => {
      if (menuRef.current && event.target instanceof Node && menuRef.current.contains(event.target)) return;
      close(false);
    };
    const onResize = () => close(false);
    document.addEventListener("pointerdown", onPointer);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onResize);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onResize);
    };
  }, [open, close]);

  function onTriggerKeyDown(event: React.KeyboardEvent<HTMLButtonElement>) {
    if (event.key === "ArrowDown" || event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      openMenu("first");
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      openMenu("last");
    }
  }

  function onMenuKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    const list = enabledItems();
    const index = list.indexOf(document.activeElement as HTMLElement);
    const move = (next: number) => {
      event.preventDefault();
      list[(next + list.length) % list.length]?.focus();
    };
    switch (event.key) {
      case "Escape":
        event.preventDefault();
        close(true);
        break;
      case "Tab":
        event.preventDefault();
        close(true);
        break;
      case "ArrowDown":
        move(index + 1);
        break;
      case "ArrowUp":
        move(index - 1);
        break;
      case "Home":
        move(0);
        break;
      case "End":
        move(list.length - 1);
        break;
      default:
        break;
    }
  }

  function choose(item: ERowMenuItem) {
    if (item.disabled) return;
    close(true);
    item.onSelect?.();
  }

  const itemClass = (item: ERowMenuItem) =>
    cn(
      "flex min-h-[2.75rem] w-full items-center gap-2 rounded-[var(--e-radius-sm)] px-3 text-left text-[0.8125rem] font-[500]",
      "focus:outline-none focus-visible:bg-[hsl(var(--e-muted))] hover:bg-[hsl(var(--e-muted))]",
      item.danger ? "text-[hsl(var(--e-danger))]" : "text-[hsl(var(--e-foreground))]",
      item.disabled && "cursor-not-allowed opacity-50",
    );

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        aria-label={trigger ? undefined : label}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        disabled={disabled || items.length === 0}
        onClick={() => (open ? close(false) : openMenu("first"))}
        onKeyDown={onTriggerKeyDown}
        className={cn(
          trigger
            ? "inline-flex h-10 items-center gap-1.5 whitespace-nowrap rounded-[var(--e-radius)] px-4 text-[0.875rem] font-[550] " +
                "bg-[hsl(var(--e-primary))] text-[hsl(var(--e-primary-foreground))] hover:bg-[hsl(var(--e-primary-hover))]"
            : // The concept's `.btn.q.s`: a quiet, borderless "⋯".
              "inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-[var(--e-radius)] bg-transparent " +
                "text-[hsl(var(--e-text-secondary))] hover:bg-[hsl(var(--e-muted))]",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--e-ring))] disabled:opacity-50",
          className,
        )}
      >
        {trigger ?? <MoreHorizontal aria-hidden className="h-4 w-4" />}
      </button>
      {open && position ? (
        <EstatePortal>
          <div
            ref={menuRef}
            id={menuId}
            role="menu"
            aria-label={label}
            onKeyDown={onMenuKeyDown}
            className="fixed z-[60] overflow-y-auto rounded-[var(--e-radius-lg)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface))] p-1 shadow-[var(--e-elevation-3)]"
            style={{ top: position.top, left: position.left, width: MENU_WIDTH, maxHeight: position.maxHeight }}
          >
            {items.map((item) => (
              <React.Fragment key={item.key}>
                {item.separated ? <div role="separator" className="my-1 h-px bg-[hsl(var(--e-border))]" /> : null}
                {item.href && !item.disabled ? (
                  <a
                    role="menuitem"
                    tabIndex={-1}
                    href={item.href}
                    target={item.newTab ? "_blank" : undefined}
                    rel={item.newTab ? "noreferrer" : undefined}
                    className={itemClass(item)}
                    onClick={() => close(true)}
                  >
                    {item.icon}
                    {item.label}
                  </a>
                ) : (
                  <button
                    type="button"
                    role="menuitem"
                    tabIndex={-1}
                    aria-disabled={item.disabled || undefined}
                    title={item.disabled ? item.hint : undefined}
                    className={itemClass(item)}
                    onClick={() => choose(item)}
                  >
                    {item.icon}
                    <span className="min-w-0">
                      {item.label}
                      {item.disabled && item.hint ? (
                        <span className="block text-[0.6875rem] text-[hsl(var(--e-muted-foreground))]">{item.hint}</span>
                      ) : null}
                    </span>
                  </button>
                )}
              </React.Fragment>
            ))}
          </div>
        </EstatePortal>
      ) : null}
    </>
  );
}
