import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const pillVariants = cva(
  "inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium",
  {
    variants: {
      variant: {
        neutral: "bg-secondary text-secondary-foreground",
        info: "bg-info/10 text-info",
        success: "bg-success/10 text-success",
        warning: "bg-warning/10 text-warning",
        danger: "bg-destructive/10 text-destructive",
        primary: "bg-primary-soft text-primary",
        accent: "bg-accent/10 text-accent",
        purple: "bg-violet-100 text-violet-700 dark:bg-violet-950 dark:text-violet-200",
      },
      size: {
        sm: "text-[11px] px-1.5 py-0",
        default: "text-xs px-2 py-0.5",
      },
    },
    defaultVariants: { variant: "neutral", size: "default" },
  }
);

export interface StatusPillProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof pillVariants> {
  withDot?: boolean;
}

export const StatusPill = React.forwardRef<HTMLSpanElement, StatusPillProps>(
  ({ className, variant, size, withDot, children, ...props }, ref) => (
    <span ref={ref} className={cn(pillVariants({ variant, size }), className)} {...props}>
      {withDot ? (
        <span
          aria-label="indicator"
          className="size-1.5 rounded-full bg-current opacity-80"
        />
      ) : null}
      {children}
    </span>
  )
);
StatusPill.displayName = "StatusPill";
