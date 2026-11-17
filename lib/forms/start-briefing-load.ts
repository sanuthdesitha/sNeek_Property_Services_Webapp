/**
 * Load the start briefing for one job from the database: the job's tasks a
 * cleaner may see, resolved with the job meta by `resolveStartBriefingItems`.
 *
 * One query for every caller that has to agree on the list (the start gate,
 * the re-confirm route and the cleaner's job payload), because the
 * acknowledgement fingerprint covers the whole list: two callers building it
 * from different task queries would never produce the same fingerprint.
 */
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import type { JobMeta } from "@/lib/jobs/meta";
import { resolveStartBriefingItems, type ResolvedStartBriefingItem } from "./start-briefing";

type BriefingDatabase = { jobTask: Pick<Prisma.TransactionClient["jobTask"], "findMany"> };

export type StartBriefingMeta = Parameters<typeof resolveStartBriefingItems>[0]["meta"] & Partial<Pick<JobMeta, "startBriefingAcks">>;

export async function loadStartBriefingItems(
  jobId: string,
  meta: StartBriefingMeta,
  database: BriefingDatabase = db,
): Promise<ResolvedStartBriefingItem[]> {
  const tasks = await database.jobTask.findMany({
    // The same visibility rule the cleaner's task list uses: correspondence
    // between the client and the office is never read out to a cleaner.
    where: { jobId, visibleToCleaner: true, executionStatus: "OPEN" },
    select: {
      id: true,
      title: true,
      description: true,
      source: true,
      approvalStatus: true,
      visibleToCleaner: true,
      executionStatus: true,
    },
  });
  return resolveStartBriefingItems({
    meta,
    jobTasks: tasks.map((task) => ({
      id: task.id,
      title: task.title,
      description: task.description,
      source: String(task.source ?? ""),
      approvalStatus: String(task.approvalStatus ?? ""),
      visibleToCleaner: task.visibleToCleaner,
      executionStatus: String(task.executionStatus ?? "OPEN"),
    })),
  });
}
