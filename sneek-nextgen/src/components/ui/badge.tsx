import { cn } from "@/lib/utils";
import { forwardRef, HTMLAttributes } from "react";

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  variant?: "default" | "success" | "warning" | "danger" | "info" | "neutral";
}

const Badge = forwardRef<HTMLSpanElement, BadgeProps>(
  ({ className, variant = "default", ...props }, ref) => {
    const variants: Record<NonNullable<BadgeProps["variant"]>, string> = {
      default: "bg-brand-100 text-brand-800 dark:bg-brand-900 dark:text-brand-200",
      success: "bg-success-50 text-success-700 dark:bg-success-700/30 dark:text-success-400",
      warning: "bg-warning-50 text-warning-700 dark:bg-warning-700/30 dark:text-warning-400",
      danger: "bg-danger-50 text-danger-700 dark:bg-danger-700/30 dark:text-danger-400",
      info: "bg-info-50 text-info-600 dark:bg-info-700/30 dark:text-info-400",
      neutral: "bg-neutral-100 text-neutral-700 dark:bg-neutral-800 dark:text-neutral-300",
    };

    return (
      <span
        ref={ref}
        className={cn(
          "inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium",
          variants[variant],
          className,
        )}
        {...props}
      />
    );
  },
);

Badge.displayName = "Badge";

export { Badge };
