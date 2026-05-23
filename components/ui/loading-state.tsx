import { cn } from "@/lib/utils";

export interface LoadingStateProps {
  /** "list" | "card" | "page" — visual treatment */
  variant?: "list" | "card" | "page";
  className?: string;
  rows?: number;
}

export function LoadingState({ variant = "list", className, rows = 4 }: LoadingStateProps) {
  if (variant === "card") {
    return (
      <div className={cn("space-y-3 rounded-lg border border-border bg-surface p-4", className)}>
        <div className="skeleton h-5 w-2/3 rounded" />
        <div className="skeleton h-3 w-full rounded" />
        <div className="skeleton h-3 w-5/6 rounded" />
      </div>
    );
  }
  if (variant === "page") {
    return (
      <div className={cn("space-y-4 p-6", className)}>
        <div className="skeleton h-8 w-1/3 rounded" />
        <div className="skeleton h-4 w-2/3 rounded" />
        <div className="skeleton mt-6 h-40 w-full rounded-lg" />
      </div>
    );
  }
  return (
    <div className={cn("space-y-2", className)}>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="skeleton h-10 w-full rounded" />
      ))}
    </div>
  );
}
