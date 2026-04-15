import { cn } from "@/lib/utils";
import { forwardRef, HTMLAttributes } from "react";

export interface AlertProps extends HTMLAttributes<HTMLDivElement> {
  variant?: "default" | "success" | "warning" | "danger" | "info";
}

const Alert = forwardRef<HTMLDivElement, AlertProps>(
  ({ className, variant = "default", ...props }, ref) => {
    const variants: Record<NonNullable<AlertProps["variant"]>, string> = {
      default: "border-neutral-300 bg-neutral-50 text-text-primary dark:border-neutral-700 dark:bg-neutral-900",
      success: "border-success-500 bg-success-50 text-success-800 dark:border-success-700 dark:bg-success-900/20 dark:text-success-400",
      warning: "border-warning-500 bg-warning-50 text-warning-800 dark:border-warning-700 dark:bg-warning-900/20 dark:text-warning-400",
      danger: "border-danger-500 bg-danger-50 text-danger-800 dark:border-danger-700 dark:bg-danger-900/20 dark:text-danger-400",
      info: "border-info-500 bg-info-50 text-info-800 dark:border-info-700 dark:bg-info-900/20 dark:text-info-400",
    };

    return (
      <div
        ref={ref}
        className={cn(
          "relative w-full rounded-lg border p-4 text-sm",
          variants[variant],
          className,
        )}
        {...props}
      />
    );
  },
);
Alert.displayName = "Alert";

const AlertTitle = forwardRef<HTMLParagraphElement, HTMLAttributes<HTMLHeadingElement>>(
  ({ className, ...props }, ref) => (
    <h5 ref={ref} className={cn("mb-1 font-medium leading-none tracking-tight", className)} {...props} />
  ),
);
AlertTitle.displayName = "AlertTitle";

const AlertDescription = forwardRef<HTMLParagraphElement, HTMLAttributes<HTMLParagraphElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn("text-sm [&_p]:leading-relaxed", className)} {...props} />
  ),
);
AlertDescription.displayName = "AlertDescription";

export { Alert, AlertTitle, AlertDescription };
