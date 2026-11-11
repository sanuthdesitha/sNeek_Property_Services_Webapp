"use client";

/**
 * The person's sections, laid out either as the panel's tabs (Profile | Work |
 * Pay | Documents | Activity) or as the full account page's two columns. The
 * same section components in both, so the views cannot drift.
 *
 * In the panel, a tab is mounted the first time it is opened and then kept
 * (hidden) so an unsaved draft survives switching tabs; everything resets when
 * a different person is shown.
 */
import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import type { PersonCapabilities, PersonProfile } from "@/lib/accounts/person-types";
import { AccessSection, ContactSection } from "./contact-access-sections";
import { ActivitySection } from "./activity-section";
import { DocumentsSection } from "./documents-section";
import { NotesSection, PayrollIdentitySection, PaySection } from "./pay-notes-sections";
import { PayAndTime, RecentJobs, Recognition, VaAccess, WorkKpis } from "./work-sections";

export const PERSON_TABS = ["profile", "work", "pay", "documents", "activity"] as const;
export type PersonTab = (typeof PERSON_TABS)[number];
const TAB_LABEL: Record<PersonTab, string> = { profile: "Profile", work: "Work", pay: "Pay", documents: "Documents", activity: "Activity" };

type ViewProps = { profile: PersonProfile; caps: PersonCapabilities; onChanged: () => void };

function TabBody({ tab, profile, caps, onChanged }: ViewProps & { tab: PersonTab }) {
  const props = { profile, caps, onChanged };
  switch (tab) {
    case "profile":
      return (
        <>
          <ContactSection {...props} />
          <AccessSection {...props} />
          <PaySection {...props} />
          <NotesSection {...props} />
          <VaAccess profile={profile} />
        </>
      );
    case "work":
      return (
        <>
          <WorkKpis profile={profile} />
          <RecentJobs profile={profile} />
          <Recognition profile={profile} />
        </>
      );
    case "pay":
      return (
        <>
          <PaySection {...props} />
          <PayAndTime profile={profile} />
          <PayrollIdentitySection {...props} />
        </>
      );
    case "documents":
      return <DocumentsSection {...props} />;
    case "activity":
      return <ActivitySection userId={profile.id} />;
  }
}

export function PersonTabsView({ profile, caps, onChanged }: ViewProps) {
  const [tab, setTab] = useState<PersonTab>("profile");
  const [visited, setVisited] = useState<ReadonlySet<PersonTab>>(new Set<PersonTab>(["profile"]));
  useEffect(() => {
    setTab("profile");
    setVisited(new Set<PersonTab>(["profile"]));
  }, [profile.id]);

  function choose(next: PersonTab) {
    setTab(next);
    setVisited((current) => new Set(current).add(next));
  }

  return (
    <>
      <div role="tablist" aria-label="Person sections" className="-mx-1 flex gap-1 overflow-x-auto border-b border-[hsl(var(--e-border))] px-1 [scrollbar-width:none]">
        {PERSON_TABS.map((key) => (
          <button
            key={key}
            id={`person-tab-${key}`}
            type="button"
            role="tab"
            aria-selected={tab === key}
            aria-controls={`person-panel-${key}`}
            onClick={() => choose(key)}
            className={cn(
              "-mb-px whitespace-nowrap border-b-2 px-3 py-2 text-[0.8125rem] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--e-ring))]",
              tab === key ? "border-[hsl(var(--e-primary))] font-[600] text-[hsl(var(--e-primary))]" : "border-transparent font-[500] text-[hsl(var(--e-muted-foreground))]",
            )}
          >
            {TAB_LABEL[key]}
          </button>
        ))}
      </div>
      {PERSON_TABS.filter((key) => visited.has(key)).map((key) => (
        <div key={`${profile.id}-${key}`} id={`person-panel-${key}`} role="tabpanel" aria-labelledby={`person-tab-${key}`} hidden={tab !== key} className="flex flex-col gap-2.5">
          <TabBody tab={key} profile={profile} caps={caps} onChanged={onChanged} />
        </div>
      ))}
    </>
  );
}

/** Full-page layout: every section, two columns from lg. */
export function PersonPageView({ profile, caps, onChanged }: ViewProps) {
  const props = { profile, caps, onChanged };
  return (
    <div className="grid gap-4 xl:grid-cols-[1.4fr_1fr]">
      <div className="flex min-w-0 flex-col gap-3">
        <WorkKpis profile={profile} />
        <RecentJobs profile={profile} />
        <PayAndTime profile={profile} />
        <DocumentsSection {...props} />
        <ActivitySection userId={profile.id} />
      </div>
      <div className="flex min-w-0 flex-col gap-3">
        <ContactSection {...props} />
        <AccessSection {...props} />
        <PaySection {...props} />
        <PayrollIdentitySection {...props} />
        <NotesSection {...props} />
        <Recognition profile={profile} />
        <VaAccess profile={profile} />
      </div>
    </div>
  );
}
