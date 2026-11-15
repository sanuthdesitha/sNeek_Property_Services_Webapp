/**
 * Shared pieces of Your profile (board "Your profile", 2026-11-16): the card
 * shell with its state in the header (in words and a shape, never colour
 * alone), field classes and the section list. Plain module (no hooks), safe
 * for server pages.
 */
import * as React from "react";
import { cn } from "@/lib/utils";

export const PROFILE_INPUT =
  "mt-1 h-11 w-full min-w-0 rounded-[var(--e-radius)] border border-[hsl(var(--e-input))] bg-[hsl(var(--e-surface))] px-3 text-[16px] sm:text-[0.875rem] text-[hsl(var(--e-foreground))] disabled:opacity-60 focus:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--e-ring))]";
export const PROFILE_LABEL = "block text-[0.8125rem] font-[550]";
export const PROFILE_HINT = "mt-1 text-[0.75rem] text-[hsl(var(--e-muted-foreground))]";

export type ProfileSectionId =
  | "details"
  | "look"
  | "password"
  | "own-pin"
  | "two-step"
  | "passkeys"
  | "notifications"
  | "sending"
  | "sessions";

export type ProfileSection = { id: ProfileSectionId; label: string; group: "You" | "Security" | "Notices" };

/** Order of the section list (desktop rail and phone list). */
export const PROFILE_SECTIONS: readonly ProfileSection[] = [
  { id: "details", label: "Details", group: "You" },
  { id: "look", label: "Look and feel", group: "You" },
  { id: "password", label: "Password", group: "Security" },
  { id: "own-pin", label: "Your PIN", group: "Security" },
  { id: "two-step", label: "Two-step sign-in", group: "Security" },
  { id: "passkeys", label: "Passkeys and devices", group: "Security" },
  { id: "sessions", label: "Signed-in sessions", group: "Security" },
  { id: "notifications", label: "Notifications to you", group: "Notices" },
  { id: "sending", label: "Your sending choices", group: "Notices" },
];

export type CardState = { text: string; shape: "dot" | "ring" | "none" };

/** A card of Your profile: h2 title, optional state at the right of the title. */
export function ProfileCard({
  id,
  title,
  state,
  aside,
  className,
  children,
}: {
  id: ProfileSectionId;
  title: string;
  state?: CardState | null;
  aside?: React.ReactNode;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <section
      id={id}
      aria-labelledby={`${id}-title`}
      className={cn(
        "min-w-0 scroll-mt-24 rounded-[var(--e-radius-lg)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface))] p-4 sm:p-5",
        className,
      )}
    >
      <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
        <h2 id={`${id}-title`} className="text-[1rem] font-semibold">
          {title}
        </h2>
        {state ? (
          <span className="inline-flex items-center gap-1.5 text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">
            {state.shape === "dot" ? <span aria-hidden className="h-2 w-2 rounded-full bg-[hsl(var(--e-primary))]" /> : null}
            {state.shape === "ring" ? <span aria-hidden className="h-2 w-2 rounded-full border border-[hsl(var(--e-muted-foreground))]" /> : null}
            {state.text}
          </span>
        ) : null}
        {aside}
      </div>
      {children}
    </section>
  );
}

/** Polite status / alert line under a form. */
export function ProfileMessage({ message }: { message: { tone: "ok" | "error"; text: string } | null }) {
  if (!message) return null;
  return message.tone === "ok" ? (
    <p role="status" className="text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">
      {message.text}
    </p>
  ) : (
    <p role="alert" className="text-[0.8125rem] font-[550] text-[hsl(var(--e-danger))]">
      {message.text}
    </p>
  );
}

/** "Stop testing as … to change your own settings." */
export function impersonationText(testingAsName: string | null): string | null {
  return testingAsName ? `Stop testing as ${testingAsName} to change your own settings.` : null;
}
