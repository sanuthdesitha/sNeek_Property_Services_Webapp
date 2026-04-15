"use client";

import { cn } from "@/lib/utils";
import {
  forwardRef,
  HTMLAttributes,
  useState,
  useRef,
  useEffect,
  useCallback,
} from "react";

interface PopoverProps {
  trigger: React.ReactNode;
  children: React.ReactNode;
  align?: "start" | "end" | "center";
}

export function Popover({ trigger, children, align = "start" }: PopoverProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLDivElement>(null);

  const handleClickOutside = useCallback((e: MouseEvent) => {
    if (ref.current && !ref.current.contains(e.target as Node)) {
      setOpen(false);
    }
  }, []);

  useEffect(() => {
    if (open) {
      document.addEventListener("mousedown", handleClickOutside);
    }
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [open, handleClickOutside]);

  return (
    <div ref={ref} className="relative inline-block">
      <div ref={triggerRef} onClick={() => setOpen(!open)}>
        {trigger}
      </div>
      {open && (
        <div
          className={cn(
            "absolute z-50 mt-2 min-w-48 rounded-lg border border-border bg-surface-elevated shadow-lg animate-scale-in",
            align === "end" && "right-0",
            align === "center" && "left-1/2 -translate-x-1/2",
          )}
        >
          {children}
        </div>
      )}
    </div>
  );
}

export function PopoverContent({
  className,
  children,
  ...props
}: HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn("p-2", className)} {...props}>
      {children}
    </div>
  );
}
