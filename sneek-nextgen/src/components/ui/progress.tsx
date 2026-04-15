import { cn } from "@/lib/utils";
import { forwardRef, HTMLAttributes } from "react";

export interface ProgressProps extends HTMLAttributes<HTMLDivElement> {
  value?: number;
  max?: number;
}

const Progress = forwardRef<HTMLDivElement, ProgressProps>(
  ({ className, value = 0, max = 100, ...props }, ref) => {
    const percentage = Math.min(Math.max((value / max) * 100, 0), 100);

    return (
      <div
        ref={ref}
        className={cn(
          "relative h-2 w-full overflow-hidden rounded-full bg-neutral-200 dark:bg-neutral-800",
          className,
        )}
        {...props}
      >
        <div
          className="h-full bg-brand-600 transition-all duration-300 ease-in-out"
          style={{ width: `${percentage}%` }}
        />
      </div>
    );
  },
);

Progress.displayName = "Progress";

export { Progress };
