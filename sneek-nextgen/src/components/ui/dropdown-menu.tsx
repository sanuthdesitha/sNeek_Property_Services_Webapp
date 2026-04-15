"use client";

import { cn } from "@/lib/utils";
import { forwardRef, HTMLAttributes, useState, useRef, useEffect } from "react";

interface DropdownMenuProps {
  trigger: React.ReactNode;
  children: React.ReactNode;
  align?: "start" | "end";
}

export function DropdownMenu({ trigger, children, align = "start" }: DropdownMenuProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  return (
    <div ref={ref} className="relative inline-block">
      <div onClick={() => setOpen(!open)}>{trigger}</div>
      {open && (
        <div
          className={cn(
            "absolute z-50 mt-2 min-w-48 rounded-lg border border-border bg-surface-elevated shadow-lg animate-scale-in",
            align === "end" ? "right-0" : "left-0",
          )}
        >
          {children}
        </div>
      )}
    </div>
  );
}

export function DropdownMenuItem({
  className,
  children,
  ...props
}: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "px-3 py-2 text-sm cursor-pointer transition-colors hover:bg-neutral-100 dark:hover:bg-neutral-800 text-text-primary",
        className,
      )}
      {...props}
    >
      {children}
    </div>
  );
}

export function DropdownMenuSeparator({ className }: { className?: string }) {
  return <div className={cn("my-1 h-px bg-border", className)} />;
}

export function DropdownMenuLabel({ className, children }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn("px-3 py-1.5 text-xs font-medium text-text-tertiary", className)}>
      {children}
    </div>
  );
}
