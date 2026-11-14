"use client";

/**
 * Your profile (board "Your profile", 2026-11-16): one page of cards with a
 * section list on the left. On a phone the page is the section list (with a
 * one-line state for each); choosing one shows that card alone with a back
 * button. Unsaved fields survive moving between sections because every card
 * stays mounted (hidden, not unmounted).
 */
import * as React from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { useIsPhone } from "@/components/v2/ui/use-phone";
import { EToneNotice } from "@/components/v2/ui/tone-band";
import { OwnPinSection } from "./own-pin-section";
import { EPasskeySection } from "@/components/v2/shared/passkey-section";
import { PROFILE_SECTIONS, type ProfileSectionId } from "./profile-card";
import {
  DetailsCard,
  LookAndFeelCard,
  NotificationsCard,
  PasswordCard,
  SendingChoicesCard,
  type DensityChoice,
  type NotificationCategoryInfo,
  type ProfileDetails,
  type ThemeChoice,
} from "./profile-cards";
import { TwoStepCard } from "./two-step-card";
import { SessionsCard } from "./sessions-card";

export type ProfileSummaries = Record<ProfileSectionId, string>;

export type ProfileWorkspaceProps = {
  details: ProfileDetails;
  theme: ThemeChoice;
  density: DensityChoice;
  passwordChanged: string | null;
  timeZone: string;
  categories: NotificationCategoryInfo[];
  sendingKindLabels: Record<string, string>;
  summaries: ProfileSummaries;
  /** Name of the account being tested as; every change is refused meanwhile. */
  testingAsName: string | null;
  /** Opened from the two-step prompt (?setup=two-step). */
  twoStepPrompted: boolean;
};

export function ProfileWorkspace(props: ProfileWorkspaceProps) {
  const phone = useIsPhone();
  const [open, setOpen] = React.useState<ProfileSectionId | null>(props.twoStepPrompted ? "two-step" : null);
  const readOnlyReason = props.testingAsName ? `Stop testing as ${props.testingAsName} to change your own settings.` : null;

  // A phone shows one section at a time; from 640px up every card is visible.
  const showCard = (id: ProfileSectionId) => !phone || open === id;
  const cardClass = (id: ProfileSectionId) => cn(!showCard(id) && "hidden");

  return (
    <div className="grid min-w-0 grid-cols-1 gap-5 lg:grid-cols-[12rem_minmax(0,1fr)]">
      {/* Section list: a sticky rail on desktop, the page itself on a phone until a section is chosen. */}
      <nav aria-label="Profile sections" className={cn("min-w-0", phone ? (open ? "hidden" : "") : "max-lg:hidden max-sm:block")}>
        <SectionList summaries={props.summaries} phone={phone} onOpen={(id) => {
          if (phone) setOpen(id);
          else document.getElementById(id)?.scrollIntoView({ block: "start" });
        }} />
      </nav>

      <div className={cn("min-w-0 space-y-4", phone && open ? "" : "max-sm:hidden")}>
        {phone && open ? (
          <button type="button" onClick={() => setOpen(null)} className="inline-flex min-h-11 items-center gap-1 text-[0.875rem] font-[550] text-[hsl(var(--e-primary))]">
            <ChevronLeft aria-hidden className="h-4 w-4" /> All sections
          </button>
        ) : null}
        {readOnlyReason ? (
          <EToneNotice tone="info" title="Testing as someone else">
            This page always shows your own account. While testing, every change here is refused: {readOnlyReason}
          </EToneNotice>
        ) : null}

        <div className="grid min-w-0 grid-cols-1 gap-4 xl:grid-cols-2">
          <div className={cardClass("details")}><DetailsCard initial={props.details} readOnlyReason={readOnlyReason} /></div>
          <div className={cardClass("own-pin")}><OwnPinSection timeZone={props.timeZone} /></div>
          <div className={cardClass("look")}><LookAndFeelCard initialTheme={props.theme} initialDensity={props.density} readOnlyReason={readOnlyReason} /></div>
          <div className={cardClass("password")}><PasswordCard changedLabel={props.passwordChanged} readOnlyReason={readOnlyReason} /></div>
          <div className={cardClass("two-step")}><TwoStepCard timeZone={props.timeZone} readOnlyReason={readOnlyReason} prompted={props.twoStepPrompted} /></div>
          <div className={cardClass("passkeys")}><EPasskeySection variant="profile" timeZone={props.timeZone} readOnlyReason={readOnlyReason} /></div>
          <div className={cn("xl:col-span-2", cardClass("notifications"))}><NotificationsCard categories={props.categories} readOnlyReason={readOnlyReason} /></div>
          <div className={cardClass("sending")}><SendingChoicesCard kindLabels={props.sendingKindLabels} timeZone={props.timeZone} readOnlyReason={readOnlyReason} /></div>
          <div className={cardClass("sessions")}><SessionsCard timeZone={props.timeZone} readOnlyReason={readOnlyReason} /></div>
        </div>
      </div>
    </div>
  );
}

function SectionList({ summaries, phone, onOpen }: { summaries: ProfileSummaries; phone: boolean; onOpen: (id: ProfileSectionId) => void }) {
  const groups = ["You", "Security", "Notices"] as const;
  return (
    <div className="space-y-4 lg:sticky lg:top-4">
      {groups.map((group) => (
        <div key={group}>
          <p className="mb-1 text-[0.6875rem] font-[600] uppercase tracking-[0.08em] text-[hsl(var(--e-text-faint))] lg:hidden">{group}</p>
          <ul className={cn(phone && "divide-y divide-[hsl(var(--e-border))] rounded-[var(--e-radius-lg)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface))]")}>
            {PROFILE_SECTIONS.filter((section) => section.group === group).map((section) => (
              <li key={section.id}>
                <button
                  type="button"
                  onClick={() => onOpen(section.id)}
                  className={cn(
                    "flex min-h-11 w-full items-center justify-between gap-2 rounded-[var(--e-radius)] px-3 text-left text-[0.875rem]",
                    "hover:bg-[hsl(var(--e-muted)/0.5)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--e-ring))]",
                  )}
                >
                  <span className="min-w-0">{section.label}</span>
                  <span className="inline-flex min-w-0 shrink items-center gap-1 truncate text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
                    {summaries[section.id]}
                    {phone ? <ChevronRight aria-hidden className="h-4 w-4 shrink-0" /> : null}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      ))}
      <p className="hidden text-[0.75rem] text-[hsl(var(--e-muted-foreground))] lg:block">Opened from your name at the foot of the menu. The old link /v2/admin/profile keeps working.</p>
    </div>
  );
}
