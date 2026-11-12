"use client";

import { describeAccess, newLines } from "@/lib/rbac/access-plain-language";
import { ADMIN_ONLY_ACTIONS } from "@/lib/rbac/capabilities";
import { lastReviewed, STALE_REVIEW_DAYS, type AccessHistoryEntry, type AccessPerson } from "@/lib/rbac/access-screen-types";
import type { OpsPolicy } from "@/lib/rbac/ops-policy";
import { EButton } from "@/components/v2/ui/primitives";
import { AccessBadge } from "./access-badges";
import { firstName, formatDay, formatWhen } from "./access-labels";

const listClass = "m-0 space-y-1.5 pl-[18px] text-[0.8125rem]";

/** Right column: plain-language access, Test as, change history, what stays with administrators. */
export function AccessSummaryPanel({
  person,
  isAdminTarget,
  draft,
  saved,
  history,
  timeZone,
  canTestAs,
}: {
  person: AccessPerson;
  isAdminTarget: boolean;
  draft: OpsPolicy;
  saved: OpsPolicy;
  history: AccessHistoryEntry[];
  timeZone: string;
  canTestAs: boolean;
}) {
  const name = firstName(person);
  const draftText = describeAccess(draft, person.id);
  const fresh = newLines(draftText, describeAccess(saved, person.id));
  const entries = history.filter((entry) => entry.subjectId === person.id).slice(0, 6);
  const reviewed = lastReviewed(history, person.id);
  return (
    <aside aria-label="Effective access" className="flex min-w-0 flex-col gap-2.5 rounded-[var(--e-radius-lg)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface))] p-4 lg:w-[286px] lg:flex-none">
      <p className="e-eyebrow">What {name} can do</p>
      {isAdminTarget ? (
        <p className="text-[0.8125rem]">Everything in the office, by rule. Administrators are never limited by presets or levels. To limit {name}, change the role in Accounts.</p>
      ) : (
        <>
          <p className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">After saving. Written from the levels on the left.</p>
          <b className="text-[0.8125rem]">Can</b>
          {draftText.can.length ? (
            <ul className={listClass}>
              {draftText.can.map((line) => (
                <li key={line}>{fresh.has(line) ? <><AccessBadge tone="gold">New</AccessBadge>{" "}</> : null}{line}</li>
              ))}
            </ul>
          ) : (
            <p className="text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">Nothing in the office yet.</p>
          )}
          <b className="text-[0.8125rem]">Cannot</b>
          <ul className={listClass}>
            {draftText.cannot.map((line) => <li key={line}>{line}</li>)}
            <li>Do anything that stays with administrators (below)</li>
          </ul>
        </>
      )}
      {canTestAs && !isAdminTarget ? (
        <div className="flex flex-wrap items-center gap-2">
          <EButton asChild size="sm" variant="outline">
            <a href={`/v2/admin/system/test-as?user=${encodeURIComponent(person.id)}`}>Test as {name}</a>
          </EButton>
          <span className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">Opens their view read-only, recorded in the Activity log</span>
        </div>
      ) : null}
      <hr className="border-[hsl(var(--e-border))]" />
      <div className="flex items-center justify-between">
        <p className="e-eyebrow">Change history</p>
        <a className="text-[0.75rem] underline" href="/v2/admin/activity">Activity log</a>
      </div>
      {entries.length ? (
        <ol className="m-0 list-none space-y-2 p-0 text-[0.75rem]">
          {entries.map((entry) => (
            <li key={entry.id}>
              <b>{formatWhen(entry.at, timeZone)}</b> · {entry.actorName}
              <span className="block text-[hsl(var(--e-muted-foreground))]">{entry.text}</span>
            </li>
          ))}
        </ol>
      ) : (
        <p className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">No saved changes for {name} yet.</p>
      )}
      <hr className="border-[hsl(var(--e-border))]" />
      <p className="e-eyebrow">Only administrators</p>
      <ul className="m-0 space-y-1 pl-[18px] text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
        {ADMIN_ONLY_ACTIONS.map((item) => (
          <li key={item.label}><span className="text-[hsl(var(--e-foreground))]">{item.label}.</span> {item.reason}</li>
        ))}
      </ul>
      <p className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">Password and two-step resets, Test as and editing access can be granted to one person at a time below their levels; they stay sensitive and ask for that person's own PIN. Each administrator and operations manager sets their own PIN in their profile; nobody uses anyone else's.</p>
      <hr className="border-[hsl(var(--e-border))]" />
      <p className="e-eyebrow">Last reviewed</p>
      <p className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
        {reviewed ? `${formatDay(reviewed.at, timeZone)} by ${reviewed.actorName}.` : "Not reviewed on this screen yet."} Access not reviewed for {STALE_REVIEW_DAYS} days is flagged on the left.
      </p>
    </aside>
  );
}
