import { recordPartnerWeightPrice } from "@/lib/laundry/partner-entries";
import { handlePartnerEntry } from "@/lib/laundry/partner-entry-http";

export const dynamic = "force-dynamic";

/**
 * POST { weightKg?, price?, note?, expectedUpdatedAt } — a laundry partner team
 * member adds the weight and / or their price for a set at the laundry (before
 * drop-off). Optional details; LAUNDRY only, never while impersonating.
 */
export async function POST(request: Request, { params }: { params: { taskId: string } }) {
  return handlePartnerEntry(request, (viewer, body) => recordPartnerWeightPrice(viewer, params.taskId, body), "The weight and price could not be saved.");
}
