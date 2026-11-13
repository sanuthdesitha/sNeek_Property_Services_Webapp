import { Suspense } from "react";
import Link from "next/link";
import { EButton } from "@/components/v2/ui/primitives";
import { EPhoneActionBar } from "@/components/v2/ui/phone-bars";
import { CommandSearch } from "@/components/v2/admin/command/command-search";
import { AskPanel } from "@/components/v2/admin/command/ask-panel";
import { SectionLoading } from "@/components/v2/admin/command/section-state";
import { CleanersSection, GlanceSection, MoneySection, QueueSection, TilesSection } from "@/components/v2/admin/command/command-sections";
import { requireCommandViewer } from "@/lib/dashboard/command-access";
import { commandTimeZone, loadCommandHeader } from "@/lib/dashboard/command-sections";
import { viewerSeesMoney } from "@/lib/dashboard/command-money";
import { viewerCanOpen } from "@/lib/dashboard/command-viewer";
import { CALENDAR_HREF } from "@/lib/dashboard/work-queue-links";

export const metadata = { title: "Command · Estate admin" };
export const dynamic = "force-dynamic";

/**
 * Command: today's date and summary, four filtered counters, the work queue
 * (every decision waiting, most urgent first, with inline actions), today by
 * cleaner, money this month (finance or payroll access only) and, below the
 * fold, today by status, on shift, upcoming, recent feedback and laundry due.
 *
 * Each section loads and refreshes on its own (every 30 s, money every 5 min),
 * so one failed query fails one section, with its own Retry.
 */
export default async function AdminCommandPage() {
  const viewer = await requireCommandViewer();
  const timeZone = await commandTimeZone();
  const header = await loadCommandHeader(new Date(), timeZone);
  const showMoney = viewerSeesMoney(viewer);
  const canCreateJob = !viewer.readOnly && viewerCanOpen(viewer, "/v2/admin/jobs/new");

  return (
    <div className="min-w-0 space-y-[14px] break-words">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <h1 className="e-display-md">{header.dateLabel}</h1>
          <p className="mt-1 text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">
            {header.summary ?? "Today's summary could not be read just now."}
          </p>
        </div>
        {/* Phones: search is the header's ⌕ (the same portal search) and New job
            is the docked action below, so the work queue starts higher up. */}
        <div className="flex w-full min-w-0 flex-wrap items-center gap-3 sm:w-auto max-sm:hidden">
          <CommandSearch />
          {canCreateJob ? <EButton asChild size="sm"><Link href="/v2/admin/jobs/new">New job</Link></EButton> : null}
        </div>
      </header>

      <AskPanel />

      <Suspense fallback={<SectionLoading label="counters" rows={1} />}>
        <TilesSection viewer={viewer} timeZone={timeZone} />
      </Suspense>

      <div className="grid min-w-0 grid-cols-1 items-start gap-[14px] xl:grid-cols-[minmax(0,1fr)_420px]">
        <Suspense fallback={<SectionLoading label="the work queue" rows={6} />}>
          <QueueSection viewer={viewer} timeZone={timeZone} />
        </Suspense>

        <aside aria-label="Today by cleaner" className="min-w-0 rounded-[var(--e-radius-lg)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface))]">
          <div className="flex items-center justify-between gap-2 border-b border-[hsl(var(--e-border))] px-4 py-3.5">
            <h2 className="text-[0.8125rem] font-[600]">Today by cleaner</h2>
            <Link href={CALENDAR_HREF} className="text-[0.8125rem]">Open calendar</Link>
          </div>
          <div className="space-y-3 px-4 py-3.5">
            <Suspense fallback={<SectionLoading label="today by cleaner" rows={4} />}>
              <CleanersSection viewer={viewer} timeZone={timeZone} />
            </Suspense>
            {showMoney ? (
              <>
                <div className="h-px bg-[hsl(var(--e-border))]" />
                <Suspense fallback={<SectionLoading label="money this month" rows={3} />}>
                  <MoneySection viewer={viewer} timeZone={timeZone} />
                </Suspense>
              </>
            ) : null}
          </div>
        </aside>
      </div>

      <Suspense fallback={<SectionLoading label="today at a glance" rows={3} />}>
        <GlanceSection viewer={viewer} timeZone={timeZone} />
      </Suspense>

      {canCreateJob ? (
        <EPhoneActionBar label="Command actions" primary={<EButton asChild><Link href="/v2/admin/jobs/new">New job</Link></EButton>} />
      ) : null}
    </div>
  );
}
