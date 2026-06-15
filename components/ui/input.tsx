import * as React from "react";
import { cn } from "@/lib/utils";

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {}

const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, type, autoComplete, ...props }, ref) => {
    return (
      <input
        type={type}
        // Default off so the browser's "recently typed" history dropdown doesn't
        // pop on every field. Fields that genuinely want it (login email/password
        // for password managers) pass an explicit autoComplete to opt back in.
        autoComplete={autoComplete ?? "off"}
        className={cn(
          "flex h-10 w-full rounded-lg border border-input bg-surface px-3 py-2 text-sm shadow-xs transition-colors",
          "ring-offset-background placeholder:text-muted-foreground",
          "file:border-0 file:bg-transparent file:text-sm file:font-medium",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
          "disabled:cursor-not-allowed disabled:opacity-50",
          "[[data-density=compact]_&]:h-8 [[data-density=comfortable]_&]:h-12",
          className
        )}
        ref={ref}
        {...props}
      />
    );
  }
);
Input.displayName = "Input";

export { Input };
