/**
 * The signed-in cleaner's own guest-timing acknowledgement, for the job
 * payload their job screen reads (GET /api/jobs/[id]/form).
 *
 * It carries the current briefing items with the status, so the job screen
 * can re-open the same briefing dialog when the office changed the time after
 * the cleaner confirmed it. A failure to read is reported as "unreadable",
 * never as confirmed.
 */
import type { ResolvedStartBriefingItem } from "@/lib/forms/start-briefing";
import { loadStartBriefingItems, type StartBriefingMeta } from "@/lib/forms/start-briefing-load";
import { ownTimingAckStatus, type OwnTimingAckStatus } from "@/lib/jobs/job-page/timing-ack";

export type OwnTimingAckPayload = {
  status: OwnTimingAckStatus;
  /** The briefing as it stands now (empty when the status is "none" or "unreadable"). */
  items: ResolvedStartBriefingItem[];
};

export async function loadOwnTimingAck(input: {
  jobId: string;
  meta: StartBriefingMeta;
  userId: string;
}): Promise<OwnTimingAckPayload> {
  try {
    const items = await loadStartBriefingItems(input.jobId, input.meta);
    const rawAck = input.meta.startBriefingAcks?.[input.userId];
    const status = ownTimingAckStatus({ items, rawAck });
    return { status, items: status === "none" || status === "unreadable" ? [] : items };
  } catch {
    return { status: "unreadable", items: [] };
  }
}
