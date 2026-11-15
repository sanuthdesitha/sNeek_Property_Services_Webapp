import { NextRequest } from "next/server";
import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { findDuplicateSources, loadDuplicateSource } from "@/lib/jobs/new-job/duplicate-source";
import { previewError, previewJson } from "@/lib/jobs/new-job/http";

/**
 * GET /api/admin/jobs/new-job/duplicate?q=J-1051 | ?jobId=… — the copyable
 * parts of earlier jobs for "Duplicate a job". Read only.
 */
export async function GET(req: NextRequest) {
  try {
    await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const jobId = req.nextUrl.searchParams.get("jobId")?.trim();
    if (jobId) {
      const source = await loadDuplicateSource(jobId);
      if (!source) return previewJson({ error: "That job was not found." }, 404);
      return previewJson({ sources: [source] });
    }
    const q = req.nextUrl.searchParams.get("q") ?? "";
    return previewJson({ sources: await findDuplicateSources(q.slice(0, 80)) });
  } catch (err) {
    return previewError(err, "Could not find jobs to copy.");
  }
}
