import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { EButton, EPageHeader } from "@/components/v2/ui/primitives";
import { NewJobForm } from "@/components/v2/admin/jobs/new-job-form";

export const metadata = { title: "New job · Estate admin" };
export const dynamic = "force-dynamic";

export default async function V2AdminNewJobPage({
  searchParams,
}: {
  searchParams: { propertyId?: string };
}) {
  await requireRole([Role.ADMIN, Role.OPS_MANAGER]);

  return (
    <div className="space-y-6">
      <EPageHeader
        eyebrow="Operations"
        title="Create jobs"
        description="Single create, draft save, and bulk scheduling in one Estate flow."
        actions={
          <EButton variant="outline" asChild>
            <Link href="/v2/admin/jobs">
              <ArrowLeft className="h-4 w-4" />
              Back to jobs
            </Link>
          </EButton>
        }
      />
      <NewJobForm initialPropertyId={searchParams.propertyId} />
    </div>
  );
}
