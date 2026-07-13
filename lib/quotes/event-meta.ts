/**
 * Quote activity timeline — client-safe metadata (types + UI labels/icons).
 *
 * Kept separate from `events.ts` (the server-side recorder that touches the
 * DB) so the client timeline component can import event types + display meta
 * WITHOUT pulling Prisma / `server-only` into the browser bundle.
 */
import {
  Briefcase,
  CheckCircle2,
  Eye,
  Mail,
  PlusCircle,
  StickyNote,
  XCircle,
  type LucideIcon,
} from "lucide-react";

export type QuoteEventType =
  | "EMAIL_SENT"
  | "VIEWED"
  | "ACCEPTED"
  | "DECLINED"
  | "ADDON_REQUESTED"
  | "CONVERTED"
  | "NOTE";

/** Estate badge tones (mirrors the `EBadge` tone union). */
export type EventTone = "neutral" | "info" | "success" | "danger" | "gold";

export const QUOTE_EVENT_META: Record<
  QuoteEventType,
  { label: string; icon: LucideIcon; tone: EventTone }
> = {
  EMAIL_SENT: { label: "Email sent", icon: Mail, tone: "info" },
  VIEWED: { label: "Viewed by client", icon: Eye, tone: "neutral" },
  ACCEPTED: { label: "Accepted", icon: CheckCircle2, tone: "success" },
  DECLINED: { label: "Declined", icon: XCircle, tone: "danger" },
  ADDON_REQUESTED: { label: "Add-ons requested", icon: PlusCircle, tone: "gold" },
  CONVERTED: { label: "Converted to job", icon: Briefcase, tone: "gold" },
  NOTE: { label: "Note", icon: StickyNote, tone: "neutral" },
};
