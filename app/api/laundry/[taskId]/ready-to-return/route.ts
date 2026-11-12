import { markReadyToReturn } from "@/lib/laundry/partner-entries";
import { handlePartnerEntry } from "@/lib/laundry/partner-entry-http";

export const dynamic = "force-dynamic";

/**
 * POST { note?, expectedUpdatedAt } — a laundry partner team member marks a
 * picked-up set "Ready to return". LAUNDRY only, never while impersonating.
 */
export async function POST(request: Request, { params }: { params: { taskId: string } }) {
  return handlePartnerEntry(request, (viewer, body) => markReadyToReturn(viewer, params.taskId, body), "The set could not be marked ready to return.");
}
