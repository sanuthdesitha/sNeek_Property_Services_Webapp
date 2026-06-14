"use client";

import * as React from "react";
import {
  Type,
  AlignLeft,
  Hash,
  Mail,
  Phone,
  DollarSign,
  Calendar,
  Clock,
  CalendarClock,
  ChevronDown,
  ListChecks,
  CheckSquare,
  CircleDot,
  ToggleLeft,
  Star,
  SlidersHorizontal,
  Plus,
  Gauge,
  Camera,
  Video,
  FileText,
  PenLine,
  Thermometer,
  QrCode,
  MapPin,
  Info,
  CircleHelp,
  type LucideIcon,
} from "lucide-react";

/**
 * Maps the lucide icon *names* stored in the field-type registry
 * (lib/forms/field-types.ts) to their React components. Field types declare
 * icons as strings so the registry stays server-safe; this client helper
 * resolves them for the builder palette / properties panel.
 */
const ICON_MAP: Record<string, LucideIcon> = {
  Type,
  AlignLeft,
  Hash,
  Mail,
  Phone,
  DollarSign,
  Calendar,
  Clock,
  CalendarClock,
  ChevronDown,
  ListChecks,
  CheckSquare,
  CircleDot,
  ToggleLeft,
  Star,
  SlidersHorizontal,
  Plus,
  Gauge,
  Camera,
  Video,
  FileText,
  PenLine,
  Thermometer,
  QrCode,
  MapPin,
  Info,
};

export function FieldIcon({
  name,
  className,
}: {
  name: string | undefined;
  className?: string;
}) {
  const Icon = (name && ICON_MAP[name]) || CircleHelp;
  return <Icon className={className} aria-hidden />;
}
