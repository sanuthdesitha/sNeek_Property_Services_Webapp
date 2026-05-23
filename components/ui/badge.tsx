import * as React from "react";
import { StatusPill, type StatusPillProps } from "@/components/ui/status-pill";

const VARIANT_MAP: Record<string, StatusPillProps["variant"]> = {
  default: "primary",
  secondary: "neutral",
  destructive: "danger",
  outline: "neutral",
  success: "success",
  warning: "warning",
};

export interface BadgeProps extends Omit<React.HTMLAttributes<HTMLSpanElement>, "children"> {
  variant?: keyof typeof VARIANT_MAP;
  children?: React.ReactNode;
}

export function Badge({ variant = "default", className, children, ...props }: BadgeProps) {
  return (
    <StatusPill variant={VARIANT_MAP[variant]} className={className} {...props}>
      {children}
    </StatusPill>
  );
}

// kept for backward compat; consumers should migrate to StatusPill
export const badgeVariants = () => "";
