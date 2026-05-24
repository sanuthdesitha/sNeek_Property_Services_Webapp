import { db } from "@/lib/db";
import { listSuppressed } from "@/lib/email/suppression";
import { Card, CardHeader, CardContent } from "@/components/ui/card";
import { StatusPill } from "@/components/ui/status-pill";
import { EmailUnsuppressButton } from "./unsuppress-button";

export const dynamic = "force-dynamic";

export default async function EmailSystemPage() {
  const suppressed = await listSuppressed(200);

  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

  // 30-day funnel — guarded against schema variation
  let funnelData: Array<{ status: string; count: number }> = [];
  try {
    const raw = await db.notificationLog.groupBy({
      by: ["status"],
      where: { channel: "EMAIL", createdAt: { gte: thirtyDaysAgo } } as any,
      _count: { _all: true },
    });
    funnelData = raw.map((r: any) => ({ status: r.status, count: r._count._all }));
  } catch {
    funnelData = [];
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-6">
      <header>
        <h1 className="text-2xl font-semibold text-foreground">Email Operations</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Suppression list and 30-day delivery funnel.
        </p>
      </header>

      <Card>
        <CardHeader>
          {/* Use h2 directly to maintain heading order under the page h1. */}
          <h2 className="text-lg font-semibold leading-tight tracking-tight text-foreground">30-day funnel</h2>
        </CardHeader>
        <CardContent>
          {funnelData.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No email activity in the last 30 days.
            </p>
          ) : (
            <ul className="grid grid-cols-2 gap-3 md:grid-cols-4">
              {funnelData.map((f) => (
                <li
                  key={f.status}
                  className="rounded border border-border bg-surface px-3 py-2"
                >
                  <div className="text-xs uppercase text-muted-foreground">
                    {f.status}
                  </div>
                  <div className="mt-1 text-2xl font-semibold">{f.count}</div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <h2 className="text-lg font-semibold leading-tight tracking-tight text-foreground">
            Suppressed addresses ({suppressed.length})
          </h2>
        </CardHeader>
        <CardContent className="p-0">
          {suppressed.length === 0 ? (
            <p className="p-6 text-sm text-muted-foreground">
              No suppressed addresses.
            </p>
          ) : (
            <table className="w-full text-sm">
              <thead className="border-b border-border bg-surface-raised text-xs uppercase text-muted-foreground">
                <tr>
                  <th className="p-3 text-left">Email</th>
                  <th className="p-3 text-left">Name</th>
                  <th className="p-3 text-left">Reason</th>
                  <th className="p-3"></th>
                </tr>
              </thead>
              <tbody>
                {suppressed.map((s) => (
                  <tr key={s.email} className="border-b border-border">
                    <td className="p-3 font-mono text-xs">{s.email}</td>
                    <td className="p-3">{s.name ?? "—"}</td>
                    <td className="p-3">
                      <StatusPill
                        variant={
                          s.status === "HARD_BOUNCE" || s.status === "COMPLAINT"
                            ? "danger"
                            : "warning"
                        }
                      >
                        {s.status}
                      </StatusPill>
                    </td>
                    <td className="p-3 text-right">
                      <EmailUnsuppressButton email={s.email} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
