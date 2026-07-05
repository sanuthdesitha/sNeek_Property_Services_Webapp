import { notFound } from "next/navigation";
import { Role } from "@prisma/client";
import { db } from "@/lib/db";
import { requireRole } from "@/lib/auth/session";
import { JobWorkspace } from "@/components/v2/cleaner/job-workspace";

export const metadata = { title: "Job · Estate cleaner" };
export const dynamic = "force-dynamic";

/**
 * Native Estate cleaner job workspace. Auth + ownership are enforced server-side
 * (assignment scoped to the session cleaner, removedAt null); the mounted
 * JobWorkspace client component owns the live execution flow (clock-in GPS,
 * checklist, native form render, submit, clock-out) via the SAME endpoints the
 * v1 workspace uses. No v1 UI is imported.
 */
export default async function CleanerJobWorkspacePage({ params }: { params: { id: string } }) {
  const session = await requireRole([Role.CLEANER]);

  const owns = await db.job
    .findFirst({
      where: { id: params.id, assignments: { some: { userId: session.user.id, removedAt: null } } },
      select: { id: true },
    })
    .catch(() => null);
  if (!owns) notFound();

  return <JobWorkspace jobId={params.id} />;
}
