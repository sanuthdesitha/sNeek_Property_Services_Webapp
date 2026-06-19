import { Upload } from "lucide-react";
import { db } from "@/lib/db";
import { Card, CardContent } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { StatusPill } from "@/components/ui/status-pill";
import { format } from "date-fns";

export const dynamic = "force-dynamic";

export default async function UploadFailuresPage() {
  const failures = await db.uploadFailure.findMany({
    where: { resolvedAt: null },
    orderBy: { occurredAt: "desc" },
    take: 100,
    include: {
      user: { select: { name: true, email: true } },
      job: { select: { jobNumber: true } },
    },
  });

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader
        className="mb-6"
        icon={<Upload />}
        title="Upload Failures"
        actions={<span className="text-sm text-muted-foreground">{failures.length} unresolved</span>}
      />
      {failures.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-muted-foreground">
            No unresolved upload failures.
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="p-0">
            <table className="w-full text-sm">
              <thead className="border-b border-border bg-surface-raised text-xs uppercase text-muted-foreground">
                <tr>
                  <th className="p-3 text-left">When</th>
                  <th className="p-3 text-left">User</th>
                  <th className="p-3 text-left">File</th>
                  <th className="p-3 text-left">Reason</th>
                  <th className="p-3 text-left">Status</th>
                </tr>
              </thead>
              <tbody>
                {failures.map((f) => (
                  <tr key={f.id} className="border-b border-border">
                    <td className="p-3 font-mono text-xs">
                      {format(f.occurredAt, "yyyy-MM-dd HH:mm")}
                    </td>
                    <td className="p-3">{f.user?.name ?? "Anonymous"}</td>
                    <td className="p-3">
                      <span className="font-mono text-xs">{f.filename}</span>
                      <span className="ml-2 text-xs text-muted-foreground">
                        {(f.size / 1024).toFixed(0)} KB
                      </span>
                      {f.job?.jobNumber && (
                        <span className="ml-2 text-xs text-muted-foreground">
                          · {f.job.jobNumber}
                        </span>
                      )}
                    </td>
                    <td className="p-3">
                      <StatusPill variant="danger">{f.reason}</StatusPill>
                      {f.message && (
                        <p className="mt-1 text-xs text-muted-foreground">{f.message}</p>
                      )}
                    </td>
                    <td className="p-3">
                      {f.resolvedAt ? (
                        <StatusPill variant="success">Resolved</StatusPill>
                      ) : (
                        <StatusPill variant="warning">Open</StatusPill>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
