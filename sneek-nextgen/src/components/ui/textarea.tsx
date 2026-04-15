import { cn } from "@/lib/utils";
import { forwardRef, TextareaHTMLAttributes } from "react";

export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string;
  error?: string;
  helperText?: string;
}

const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ className, label, error, helperText, id, ...props }, ref) => {
    const textareaId = id || label?.toLowerCase().replace(/\s+/g, "-");

    return (
      <div className="w-full">
        {label && (
          <label
            htmlFor={textareaId}
            className="block text-sm font-medium text-text-primary mb-1.5"
          >
            {label}
          </label>
        )}
        <textarea
          ref={ref}
          id={textareaId}
          className={cn(
            "w-full min-h-24 px-3 py-2 text-sm rounded-lg border transition-colors duration-200",
            "bg-transparent text-text-primary placeholder:text-text-tertiary",
            "focus:outline-none focus:ring-2 focus:ring-brand-500 focus:ring-offset-1",
            "disabled:pointer-events-none disabled:opacity-50 resize-y",
            error
              ? "border-danger-500 focus:ring-danger-500"
              : "border-neutral-300 dark:border-neutral-700 hover:border-neutral-400 dark:hover:border-neutral-600",
            className,
          )}
          {...props}
        />
        {error && (
          <p className="mt-1.5 text-sm text-danger-600">{error}</p>
        )}
        {helperText && !error && (
          <p className="mt-1.5 text-sm text-text-tertiary">{helperText}</p>
        )}
      </div>
    );
  },
);

Textarea.displayName = "Textarea";

export { Textarea };
