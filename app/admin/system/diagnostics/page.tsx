import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { Role } from "@prisma/client";
import { Activity } from "lucide-react";
import { authOptions } from "@/lib/auth/auth-options";
import { PageHeader } from "@/components/ui/page-header";
import { DiagnosticsClient } from "./diagnostics-client";

export const dynamic = "force-dynamic";
export const metadata = { title: "System diagnostics" };

export default async function SystemDiagnosticsPage() {
  const session = await getServerSession(authOptions);
  if (session?.user?.role !== Role.ADMIN) {
    redirect("/admin");
  }

  return (
    <div className="space-y-6 p-6">
      <PageHeader
        icon={<Activity />}
        title="Diagnostics"
        description={
          <>
            Live process, database, and worker stats. Polls every 5 seconds. See{" "}
            <code className="rounded bg-muted px-1 py-0.5 text-xs">docs/ops/vps-triage.md</code>{" "}
            for VPS-side triage commands.
          </>
        }
      />
      <DiagnosticsClient />
    </div>
  );
}
