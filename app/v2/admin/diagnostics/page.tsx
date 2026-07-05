import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { listSuppressed } from "@/lib/email/suppression";
import { EPageHeader } from "@/components/v2/ui/primitives";
import { DiagnosticsHub } from "@/components/v2/admin/diagnostics/diagnostics-hub";

export const metadata = { title: "Diagnostics · Estate admin" };
export const dynamic = "force-dynamic";

export default async function DiagnosticsPage({ searchParams }: { searchParams?: { tab?: string } }) {
  // Diagnostics is ADMIN-only in v1; keep parity.
  await requireRole([Role.ADMIN]);

  const [suppressed, uploadFailures] = await Promise.all([
    listSuppressed(200).catch(() => []),
    db.uploadFailure
      .findMany({
        where: { resolvedAt: null },
        orderBy: { occurredAt: "desc" },
        take: 100,
        include: {
          user: { select: { name: true, email: true } },
          job: { select: { jobNumber: true } },
        },
      })
      .catch(() => []),
  ]);

  const email = suppressed.map((s: any) => ({
    email: s.email as string,
    reason: (s.reason as string) ?? null,
    createdAt: s.createdAt ? new Date(s.createdAt).toISOString() : null,
  }));

  const uploads = uploadFailures.map((f) => ({
    id: f.id,
    reason: (f as any).reason ?? (f as any).message ?? "Upload failed",
    occurredAt: f.occurredAt ? new Date(f.occurredAt).toISOString() : null,
    user: f.user ? f.user.name || f.user.email : null,
    job: f.job?.jobNumber ?? null,
  }));

  return (
    <div className="space-y-6">
      <EPageHeader
        eyebrow="System"
        title="Diagnostics"
        description="Live process, database, and worker health · email deliverability · upload failures."
      />
      <DiagnosticsHub
        initialTab={searchParams?.tab}
        email={email}
        uploads={uploads}
      />
    </div>
  );
}
