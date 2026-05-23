"use client";

import * as React from "react";
import { cn } from "@/lib/utils";
import { useKeyboardVisible } from "@/hooks/use-keyboard-visible";

export interface FABProps extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "children"> {
  icon: React.ReactNode;
  label?: React.ReactNode;
  hideOnModalOpen?: boolean;
}

export const FAB = React.forwardRef<HTMLButtonElement, FABProps>(
  ({ className, icon, label, hideOnModalOpen = true, "aria-label": ariaLabel, ...props }, ref) => {
    const keyboardVisible = useKeyboardVisible();
    const [modalOpen, setModalOpen] = React.useState(false);

    React.useEffect(() => {
      if (!hideOnModalOpen) return;
      // Heuristic: detect open Radix Dialog by presence of [role=dialog] in DOM
      const obs = new MutationObserver(() => {
        setModalOpen(!!document.querySelector('[role="dialog"]'));
      });
      obs.observe(document.body, { childList: true, subtree: true });
      return () => obs.disconnect();
    }, [hideOnModalOpen]);

    if (keyboardVisible || modalOpen) return null;

    return (
      <button
        ref={ref}
        type="button"
        aria-label={ariaLabel}
        className={cn(
          "fixed z-40 inline-flex items-center justify-center gap-2 rounded-full bg-primary text-primary-foreground shadow-fab",
          "transition-transform duration-150 hover:scale-105 active:scale-95",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
          "right-[calc(env(safe-area-inset-right,0px)+16px)]",
          "bottom-[calc(env(safe-area-inset-bottom,0px)+16px+var(--bottom-nav-height,0px))]",
          label ? "h-14 px-5" : "size-14",
          "md:size-12 md:bottom-6 md:right-6",
          className
        )}
        {...props}
      >
        <span className="size-5 shrink-0">{icon}</span>
        {label ? <span className="font-medium">{label}</span> : null}
      </button>
    );
  }
);
FAB.displayName = "FAB";
