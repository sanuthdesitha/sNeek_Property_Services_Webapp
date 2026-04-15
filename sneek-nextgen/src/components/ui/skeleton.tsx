import { cn } from "@/lib/utils";
import { forwardRef, HTMLAttributes } from "react";

const Skeleton = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      className={cn(
        "animate-pulse rounded-md bg-neutral-200 dark:bg-neutral-800",
        className,
      )}
      {...props}
    />
  ),
);

Skeleton.displayName = "Skeleton";

export { Skeleton };
