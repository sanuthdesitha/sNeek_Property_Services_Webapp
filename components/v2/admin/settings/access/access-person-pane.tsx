"use client";

import { useState } from "react";
import { ChevronRight } from "lucide-react";
import { ESidePanel } from "@/components/v2/ui/side-panel";
import { useIsPhone } from "@/components/v2/ui/use-phone";
import { isAdminPerson, type AccessPerson, type AccessScreenData } from "@/lib/rbac/access-screen-types";
import type { OpsPolicy } from "@/lib/rbac/ops-policy";
import { AccessAdminCapabilities } from "./access-admin-capabilities";
import { firstName } from "./access-labels";
import { AccessMatrix } from "./access-matrix";
import { AccessPersonHeader } from "./access-person-header";
import { AccessUnsavedBar } from "./access-save";
import { AccessSummaryPanel } from "./access-summary-panel";
import type { AccessDraftApi } from "./use-access-draft";

/** The selected person: header, matrix, administrator capabilities, save bar, and the right column. */
export function AccessPersonPane({
  person,
  data,
  draft,
  saved,
  names,
  editable,
  busy,
  onDraft,
  onCopy,
  onReview,
}: {
  person: AccessPerson;
  data: AccessScreenData;
  draft: OpsPolicy;
  saved: OpsPolicy;
  names: Record<string, string>;
  editable: boolean;
  busy: boolean;
  onDraft: AccessDraftApi;
  onCopy: () => void;
  onReview: () => void;
}) {
  const adminTarget = isAdminPerson(person);
  const self = person.id === data.viewer.id;
  const name = firstName(person);
  const phone = useIsPhone();
  const [summaryOpen, setSummaryOpen] = useState(false);
  const summary = (
    <AccessSummaryPanel
      person={person}
      isAdminTarget={adminTarget}
      draft={draft}
      saved={saved}
      history={data.history}
      timeZone={data.timeZone}
      canTestAs={data.viewer.isAdmin || (editable && data.viewer.grants.includes("access.test_as"))}
    />
  );
  return (
    <>
      <section aria-label={`${name}'s access`} className="flex min-w-0 flex-1 flex-col gap-3">
        <AccessPersonHeader
          person={person}
          draft={draft}
          timeZone={data.timeZone}
          isAdminTarget={adminTarget}
          editable={editable}
          onPreset={(presetId) => onDraft.setPreset(person.id, presetId)}
          onCopy={onCopy}
          onFullAccess={(on) => onDraft.setFullAccess(person.id, on)}
        />
        {self && !adminTarget ? <p className="text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">This is you. Nobody can change their own access.</p> : null}
        {!adminTarget && !editable && !self && !busy ? (
          <p className="text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">You can look at {name}&apos;s access but not change it: their access exceeds yours.</p>
        ) : null}
        {adminTarget ? null : (
          <>
            <AccessMatrix
              draft={draft}
              saved={saved}
              userId={person.id}
              personName={name}
              editable={editable}
              onLevel={(area, level) => onDraft.setLevel(person.id, area, level)}
              onCapability={(key, on) => onDraft.setCapability(person.id, key, on)}
            />
            <AccessAdminCapabilities
              draft={draft}
              saved={saved}
              userId={person.id}
              viewerIsAdmin={data.viewer.isAdmin}
              disabled={!editable}
              onToggle={(key, on) => onDraft.setCapability(person.id, key, on)}
            />
          </>
        )}
        {phone ? (
          // Phones: the right column opens as a full-screen sheet from one row.
          <button
            type="button"
            aria-haspopup="dialog"
            onClick={() => setSummaryOpen(true)}
            className="flex min-h-14 w-full items-center justify-between gap-2 rounded-[var(--e-radius-lg)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface))] px-4 text-left text-[0.875rem] font-[600] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[hsl(var(--e-ring))]"
          >
            <span className="min-w-0">
              What {name} can do
              <span className="block text-[0.75rem] font-[400] text-[hsl(var(--e-muted-foreground))]">Plain-language access, Test as, change history</span>
            </span>
            <ChevronRight aria-hidden className="h-4 w-4 shrink-0" />
          </button>
        ) : null}
        <AccessUnsavedBar saved={saved} draft={draft} names={names} busy={busy} onDiscard={() => onDraft.discard()} onReview={onReview} />
        <p className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
          Saving asks for your own PIN. {name}&apos;s next request uses the new access. If someone else saved first, you see both versions before anything is overwritten.
        </p>
      </section>
      {phone ? (
        <ESidePanel open={summaryOpen} label={`What ${name} can do`} title={`What ${name} can do`} subtitle="After saving, written from the levels" onClose={() => setSummaryOpen(false)}>
          {summaryOpen ? summary : null}
        </ESidePanel>
      ) : (
        summary
      )}
    </>
  );
}
