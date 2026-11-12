import { addDropoffPhotos } from "@/lib/laundry/partner-entries";
import { handlePartnerEntry } from "@/lib/laundry/partner-entry-http";

export const dynamic = "force-dynamic";

/**
 * POST { photoKeys, note?, expectedUpdatedAt } — a laundry partner team member
 * adds photo(s) to a finished drop-off. Append only (originals are kept);
 * only the caller's own uploads; LAUNDRY only, never while impersonating.
 */
export async function POST(request: Request, { params }: { params: { taskId: string } }) {
  return handlePartnerEntry(request, (viewer, body) => addDropoffPhotos(viewer, params.taskId, body), "The photo could not be added.");
}
