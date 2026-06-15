import * as React from "react";
import { cn } from "@/lib/utils";

export interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {}

const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ className, autoComplete, ...props }, ref) => {
    return (
      <textarea
        // Off by default so the browser's recent-entry suggestions don't appear;
        // callers can opt back in with an explicit autoComplete.
        autoComplete={autoComplete ?? "off"}
        className={cn(
          "flex min-h-[80px] w-full rounded border border-border-strong bg-surface px-3 py-2 text-sm",
          "ring-offset-background placeholder:text-muted-foreground",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
          "disabled:cursor-not-allowed disabled:opacity-50",
          className
        )}
        ref={ref}
        {...props}
      />
    );
  }
);
Textarea.displayName = "Textarea";

export { Textarea };
