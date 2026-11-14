import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { loadNewJobOptions } from "@/lib/jobs/new-job/options";
import { previewError, previewJson } from "@/lib/jobs/new-job/http";

/** GET /api/admin/jobs/new-job/options — the New job page's property picker. Read only. */
export async function GET() {
  try {
    await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    return previewJson(await loadNewJobOptions());
  } catch (err) {
    return previewError(err, "Could not load properties.");
  }
}
