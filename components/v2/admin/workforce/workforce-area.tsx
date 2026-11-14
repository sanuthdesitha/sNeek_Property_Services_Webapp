/**
 * The Workforce area (board "Workforce", 2026-11-16): one h1, the
 * introduction, the page-wide actions in the header slot and the five tabs.
 * Every tab page renders its content as `children` under the tab strip, so
 * nothing sits between the tabs and the active tab's content. Server
 * component (no hooks); the tab strip is the only client part.
 */
import * as React from "react";
import { EPageHeader } from "@/components/v2/ui/primitives";
import { workforceIntro, type WorkforceTabKey } from "@/lib/workforce/workforce-tabs";
import type { WorkforceAreaSummary } from "@/lib/workforce/area-counts";
import { WorkforceTabsNav } from "./workforce-tabs-nav";

export function WorkforceArea({
  active,
  summary,
  actions,
  children,
}: {
  active: WorkforceTabKey;
  summary: WorkforceAreaSummary;
  /** Page-wide actions of the active tab (header slot, never above the heading). */
  actions?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="min-w-0 space-y-5">
      <EPageHeader
        eyebrow="People and quality · Workforce"
        title="Workforce"
        description={workforceIntro(summary.cleaners, summary.laundry)}
        actions={actions}
      />
      <WorkforceTabsNav active={active} counts={summary.counts} />
      <div className="min-w-0">{children}</div>
    </div>
  );
}
