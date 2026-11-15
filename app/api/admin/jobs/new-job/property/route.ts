import { NextRequest } from "next/server";
import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { loadNewJobPropertyFacts } from "@/lib/jobs/new-job/property-facts";
import { propertyQuerySchema, readQuery } from "@/lib/jobs/new-job/query";
import { previewError, previewJson } from "@/lib/jobs/new-job/http";

/**
 * GET /api/admin/jobs/new-job/property?propertyId&jobType — what the New job
 * page fills in from the property (hours, rates, form, access, open tasks,
 * preferred cleaner). Read only.
 */
export async function GET(req: NextRequest) {
  try {
    await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const query = propertyQuerySchema.parse(readQuery(req.nextUrl.searchParams, ["propertyId", "jobType"]));
    const facts = await loadNewJobPropertyFacts(query.propertyId, query.jobType);
    if (!facts) return previewJson({ error: "That property was not found." }, 404);
    return previewJson(facts);
  } catch (err) {
    return previewError(err, "Could not load the property.");
  }
}
