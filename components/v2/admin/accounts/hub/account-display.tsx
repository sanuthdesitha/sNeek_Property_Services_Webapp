/**
 * Small display pieces shared by the Accounts table, the person panel and the
 * full account page, so a status or a documents state reads the same
 * everywhere. Missing values show "–", never 0.
 */
import type { Role } from "@prisma/client";
import { EPill, type EPillTone } from "@/components/v2/ui/pill";
import { ROLE_LABELS } from "@/lib/auth/roles";
import type { AccountStatus, DocumentState } from "@/lib/accounts/list/attention";

export const ORG_TIME_ZONE = "Australia/Sydney";
export const DASH = "–";

const money = new Intl.NumberFormat("en-AU", { style: "currency", currency: "AUD", minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function formatRate(rate: number | null | undefined): string | null {
  return typeof rate === "number" ? money.format(rate) : null;
}

export function formatMoney(value: number): string {
  return money.format(value);
}

export function initials(name: string | null, email: string): string {
  const source = (name ?? "").trim() || email;
  return (
    source
      .split(/[\s@._-]+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]!.toUpperCase())
      .join("") || "?"
  );
}

export function Avatar({ name, email, size = 30 }: { name: string | null; email: string; size?: number }) {
  return (
    <span
      aria-hidden
      style={{ width: size, height: size, fontSize: size >= 40 ? 14 : 11 }}
      className="inline-flex flex-none items-center justify-center rounded-full bg-[hsl(var(--e-primary-soft))] font-[600] text-[hsl(var(--e-primary))]"
    >
      {initials(name, email)}
    </span>
  );
}

export function StatusPill({ status, inviteAgeDays }: { status: AccountStatus; inviteAgeDays: number | null }) {
  if (status === "DISABLED") return <EPill tone="neutral">Disabled</EPill>;
  if (status === "INVITED") {
    const age = inviteAgeDays === null ? "" : inviteAgeDays === 0 ? " today" : ` ${inviteAgeDays} d ago`;
    return <EPill tone="info">Invited{age}</EPill>;
  }
  return <EPill tone="ok">Active</EPill>;
}

const DOCUMENT_TONE: Record<DocumentState["kind"], EPillTone> = { MISSING: "bad", EXPIRED: "bad", EXPIRING: "warn", OK: "ok", NONE: "neutral" };

export function DocumentsPill({ state }: { state: Pick<DocumentState, "kind" | "label"> }) {
  return <EPill tone={DOCUMENT_TONE[state.kind]}>{state.label}</EPill>;
}

export function RoleCell({ role, extraRoles }: { role: Role; extraRoles: Role[] }) {
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      {ROLE_LABELS[role]}
      {extraRoles.map((extra) => (
        <EPill key={extra} tone="neutral">
          + {ROLE_LABELS[extra]}
        </EPill>
      ))}
    </span>
  );
}

function sydneyKey(date: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: ORG_TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}

/** "Today", "Yesterday" or a Sydney date; "–" when never recorded. */
export function formatLastSeen(iso: string | null, now: Date = new Date()): string {
  if (!iso) return DASH;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return DASH;
  const today = sydneyKey(now);
  const yesterday = sydneyKey(new Date(now.getTime() - 24 * 60 * 60 * 1000));
  const key = sydneyKey(date);
  if (key === today) return "Today";
  if (key === yesterday) return "Yesterday";
  return date.toLocaleDateString("en-AU", { timeZone: ORG_TIME_ZONE, day: "numeric", month: "short", year: "numeric" });
}

/** Date and time in the organisation's timezone (history rows). */
export function formatDateTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString("en-AU", { timeZone: ORG_TIME_ZONE, day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" });
}

/** Calendar date (expiry, hire date): shown as stored, in the organisation's day. */
export function formatDate(iso: string | null | undefined): string {
  if (!iso) return DASH;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return DASH;
  return date.toLocaleDateString("en-AU", { timeZone: ORG_TIME_ZONE, day: "numeric", month: "short", year: "numeric" });
}

export function formatMonthYear(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? DASH : date.toLocaleDateString("en-AU", { timeZone: ORG_TIME_ZONE, month: "short", year: "numeric" });
}
