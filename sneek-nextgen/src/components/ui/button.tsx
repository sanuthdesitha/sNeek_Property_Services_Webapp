import { cn } from "@/lib/utils";
import { cloneElement, forwardRef, ButtonHTMLAttributes, ReactElement } from "react";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "secondary" | "ghost" | "destructive" | "outline";
  size?: "sm" | "md" | "lg" | "icon";
  loading?: boolean;
  asChild?: boolean;
}

const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      className,
      variant = "primary",
      size = "md",
      loading = false,
      disabled,
      asChild = false,
      children,
      ...props
    },
    ref,
  ) => {
    const base =
      "inline-flex items-center justify-center gap-2 font-medium rounded-lg transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 select-none";

    const variants: Record<NonNullable<ButtonProps["variant"]>, string> = {
      primary:
        "bg-brand-600 text-white hover:bg-brand-700 active:bg-brand-800 shadow-sm",
      secondary:
        "bg-neutral-100 text-neutral-900 hover:bg-neutral-200 active:bg-neutral-300 dark:bg-neutral-800 dark:text-neutral-100 dark:hover:bg-neutral-700",
      ghost:
        "text-neutral-700 hover:bg-neutral-100 active:bg-neutral-200 dark:text-neutral-300 dark:hover:bg-neutral-800",
      destructive:
        "bg-danger-600 text-white hover:bg-danger-700 active:bg-danger-800 shadow-sm",
      outline:
        "border border-neutral-300 bg-transparent text-neutral-700 hover:bg-neutral-50 active:bg-neutral-100 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800",
    };

    const sizes: Record<NonNullable<ButtonProps["size"]>, string> = {
      sm: "h-8 px-3 text-sm",
      md: "h-10 px-4 text-sm",
      lg: "h-12 px-6 text-base",
      icon: "h-10 w-10",
    };

    const combinedClassName = cn(base, variants[variant], sizes[size], className);

    if (asChild && children) {
      const child = children as ReactElement;
      const childProps = child.props as Record<string, unknown>;
      return cloneElement(child, {
        ...props,
        className: cn(combinedClassName, childProps?.className as string),
      } as Record<string, unknown>);
    }

    return (
      <button
        ref={ref}
        className={combinedClassName}
        disabled={disabled || loading}
        {...props}
      >
        {loading && (
          <svg
            className="animate-spin h-4 w-4"
            viewBox="0 0 24 24"
            fill="none"
          >
            <circle
              className="opacity-25"
              cx="12"
              cy="12"
              r="10"
              stroke="currentColor"
              strokeWidth="4"
            />
            <path
              className="opacity-75"
              fill="currentColor"
              d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
            />
          </svg>
        )}
        {children}
      </button>
    );
  },
);

Button.displayName = "Button";

export { Button };
