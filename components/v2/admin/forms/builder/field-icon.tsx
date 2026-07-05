"use client";

/**
 * ESTATE form builder — lucide icon resolver by name.
 * The field-type registry (lib/forms/field-types) stores lucide icon *names*
 * as strings so it stays server-safe. This client helper maps a name → icon.
 */
import * as React from "react";
import * as Lucide from "lucide-react";
import { Square } from "lucide-react";

export function EFieldIcon({
  name,
  className,
}: {
  name?: string | null;
  className?: string;
}) {
  const Icon =
    (name && (Lucide as unknown as Record<string, React.ComponentType<{ className?: string }>>)[name]) || Square;
  return <Icon className={className} />;
}
