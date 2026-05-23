import { AlertTriangle } from "lucide-react";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export interface ErrorStateProps {
  title?: ReactNode;
  message: ReactNode;
  onRetry?: () => void;
  supportLink?: { href: string; label: string };
  className?: string;
}

export function ErrorState({
  title = "Something went wrong",
  message,
  onRetry,
  supportLink,
  className,
}: ErrorStateProps) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center gap-3 rounded-lg border border-destructive/30 bg-destructive/5 p-8 text-center",
        className
      )}
      role="alert"
    >
      <AlertTriangle className="size-6 text-destructive" aria-hidden />
      <div className="space-y-1">
        <p className="text-sm font-medium text-foreground">{title}</p>
        <p className="text-xs text-muted-foreground">{message}</p>
      </div>
      <div className="flex gap-2 pt-1">
        {onRetry ? (
          <Button variant="outline" size="sm" onClick={onRetry}>
            Retry
          </Button>
        ) : null}
        {supportLink ? (
          <Button variant="ghost" size="sm" asChild>
            <a href={supportLink.href}>{supportLink.label}</a>
          </Button>
        ) : null}
      </div>
    </div>
  );
}
