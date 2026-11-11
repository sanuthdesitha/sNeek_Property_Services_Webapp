/**
 * Server wrappers for the Command sections. Each reads its own first data
 * inside its own Suspense boundary; a failed read hands the client section
 * `null`, which then shows that section's own error and Retry while the rest
 * of the page renders normally.
 */
import { loadCommandSection } from "@/lib/dashboard/command-access";
import type { CommandViewer } from "@/lib/dashboard/command-viewer";
import type { CommandSectionKey, CommandTilesPayload, GlancePayload, MoneyPayload, TodayByCleanerPayload } from "@/lib/dashboard/command-types";
import type { WorkQueuePayload } from "@/lib/dashboard/work-queue-types";
import { CommandTiles } from "./command-tiles";
import { CommandGlance } from "./command-glance";
import { MoneyThisMonth } from "./money-month";
import { TodayByCleaner } from "./today-by-cleaner";
import { WorkQueue } from "./work-queue";

type SectionProps = { viewer: CommandViewer; timeZone: string };

async function firstRead<T>(key: CommandSectionKey, viewer: CommandViewer): Promise<T | null> {
  try {
    return (await loadCommandSection(key, viewer)) as T;
  } catch {
    return null;
  }
}

export async function TilesSection({ viewer, timeZone }: SectionProps) {
  return <CommandTiles initial={await firstRead<CommandTilesPayload>("tiles", viewer)} timeZone={timeZone} />;
}

export async function QueueSection({ viewer, timeZone }: SectionProps) {
  return <WorkQueue initial={await firstRead<WorkQueuePayload>("queue", viewer)} timeZone={timeZone} readOnly={viewer.readOnly} />;
}

export async function CleanersSection({ viewer, timeZone }: SectionProps) {
  return <TodayByCleaner initial={await firstRead<TodayByCleanerPayload>("cleaners", viewer)} timeZone={timeZone} />;
}

export async function MoneySection({ viewer, timeZone }: SectionProps) {
  return <MoneyThisMonth initial={await firstRead<MoneyPayload>("money", viewer)} timeZone={timeZone} />;
}

export async function GlanceSection({ viewer, timeZone }: SectionProps) {
  return <CommandGlance initial={await firstRead<GlancePayload>("glance", viewer)} timeZone={timeZone} />;
}
