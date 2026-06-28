import { db } from "@/lib/db";
import { requireRole } from "@/lib/auth/session";
import { Role, Prisma } from "@prisma/client";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/ui/page-header";
import { format } from "date-fns";
import { toZonedTime } from "date-fns-tz";
import Link from "next/link";
import { History, ChevronLeft, ChevronRight } from "lucide-react";

const TZ = "Australia/Sydney";
const PAGE_SIZE = 50;

type SearchParams = {
  entity?: string;
  q?: string;
  user?: string;
  page?: string;
};

export const dynamic = "force-dynamic";

export default async function AdminActivityPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  await requireRole([Role.ADMIN]);

  const page = Math.max(1, parseInt(searchParams.page ?? "1", 10) || 1);
  const entity = searchParams.entity?.trim() || undefined;
  const q = searchParams.q?.trim() || undefined;
  const userQuery = searchParams.user?.trim() || undefined;

  const where: Prisma.AuditLogWhereInput = {
    ...(entity ? { entity } : {}),
    ...(q ? { action: { contains: q, mode: "insensitive" } } : {}),
    ...(userQuery
      ? {
          user: {
            OR: [
              { name: { contains: userQuery, mode: "insensitive" } },
              { email: { contains: userQuery, mode: "insensitive" } },
            ],
          },
        }
      : {}),
  };

  const [entries, total, entities] = await Promise.all([
    db.auditLog.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      select: {
        id: true,
        action: true,
        entity: true,
        entityId: true,
        jobId: true,
        before: true,
        after: true,
        ipAddress: true,
        createdAt: true,
        user: { select: { name: true, email: true, role: true } },
      },
    }),
    db.auditLog.count({ where }),
    db.auditLog.findMany({
      distinct: ["entity"],
      select: { entity: true },
      orderBy: { entity: "asc" },
      take: 100,
    }),
  ]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const baseQuery = new URLSearchParams();
  if (entity) baseQuery.set("entity", entity);
  if (q) baseQuery.set("q", q);
  if (userQuery) baseQuery.set("user", userQuery);
  const pageHref = (p: number) => {
    const params = new URLSearchParams(baseQuery);
    params.set("page", String(p));
    return `/admin/activity?${params.toString()}`;
  };

  return (
    <div className="space-y-6">
      <PageHeader
        icon={<History />}
        title="Activity log"
        description="Every audited action across the platform — who changed what, and when."
        actions={
          <p className="text-xs tabular-nums text-muted-foreground">
            {total.toLocaleString()} entries
          </p>
        }
      />

      {/* Filters */}
      <form
        method="GET"
        className="flex flex-col gap-2 sm:flex-row sm:items-center"
      >
        <input
          type="search"
          name="q"
          defaultValue={q ?? ""}
          placeholder="Search actions…"
          className="h-9 w-full rounded-lg border border-input bg-surface px-3 text-sm shadow-xs placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:max-w-xs"
        />
        <input
          type="search"
          name="user"
          defaultValue={userQuery ?? ""}
          placeholder="Filter by user name or email…"
          className="h-9 w-full rounded-lg border border-input bg-surface px-3 text-sm shadow-xs placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:max-w-xs"
        />
        <select
          name="entity"
          defaultValue={entity ?? ""}
          className="h-9 rounded-lg border border-input bg-surface px-3 text-sm shadow-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <option value="">All entities</option>
          {entities.map((e) => (
            <option key={e.entity} value={e.entity}>
              {e.entity}
            </option>
          ))}
        </select>
        <button
          type="submit"
          className="h-9 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground transition hover:bg-primary/90"
        >
          Apply
        </button>
        {(entity || q || userQuery) && (
          <Link
            href="/admin/activity"
            className="text-xs text-muted-foreground hover:text-foreground hover:underline"
          >
            Clear filters
          </Link>
        )}
      </form>

      {/* Entries */}
      <Card>
        <CardContent className="p-0">
          {entries.length === 0 ? (
            <p className="px-6 py-12 text-center text-sm text-muted-foreground">
              No audit entries match the current filters.
            </p>
          ) : (
            <div className="divide-y divide-border">
              {entries.map((entry) => {
                const hasDiff = entry.before != null || entry.after != null;
                return (
                  <details key={entry.id} className="group">
                    <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 transition hover:bg-surface-raised sm:px-6 [&::-webkit-details-marker]:hidden">
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm text-foreground">
                          <span className="font-semibold">
                            {entry.user?.name ?? "System"}
                          </span>{" "}
                          <span className="text-muted-foreground">
                            {entry.action.replace(/[._]/g, " ").toLowerCase()}
                          </span>
                        </p>
                        <p className="mt-0.5 truncate text-xs text-muted-foreground">
                          {entry.user?.email ?? ""}
                          {entry.ipAddress ? ` · ${entry.ipAddress}` : ""}
                        </p>
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        <Badge variant="outline" className="font-mono text-[10px]">
                          {entry.entity}
                        </Badge>
                        {entry.jobId ? (
                          <Link
                            href={`/admin/jobs/${entry.jobId}`}
                            className="text-xs text-primary hover:underline"
                          >
                            Job →
                          </Link>
                        ) : null}
                        <span className="text-xs tabular-nums text-muted-foreground">
                          {format(
                            toZonedTime(entry.createdAt, TZ),
                            "d MMM yyyy · HH:mm:ss",
                          )}
                        </span>
                      </div>
                    </summary>
                    {hasDiff ? (
                      <div className="grid gap-3 border-t border-border/60 bg-surface-raised/50 px-4 py-3 sm:grid-cols-2 sm:px-6">
                        <div>
                          <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                            Before
                          </p>
                          <pre className="max-h-64 overflow-auto rounded-lg border border-border bg-surface p-3 text-[11px] leading-relaxed text-muted-foreground">
                            {entry.before != null
                              ? JSON.stringify(entry.before, null, 2)
                              : "—"}
                          </pre>
                        </div>
                        <div>
                          <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                            After
                          </p>
                          <pre className="max-h-64 overflow-auto rounded-lg border border-border bg-surface p-3 text-[11px] leading-relaxed text-muted-foreground">
                            {entry.after != null
                              ? JSON.stringify(entry.after, null, 2)
                              : "—"}
                          </pre>
                        </div>
                      </div>
                    ) : (
                      <p className="border-t border-border/60 bg-surface-raised/50 px-4 py-3 text-xs text-muted-foreground sm:px-6">
                        No payload recorded for this action. Entity ID:{" "}
                        <span className="font-mono">{entry.entityId}</span>
                      </p>
                    )}
                  </details>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Pagination */}
      {totalPages > 1 ? (
        <div className="flex items-center justify-between">
          <p className="text-xs text-muted-foreground">
            Page {page} of {totalPages}
          </p>
          <div className="flex gap-2">
            {page > 1 ? (
              <Link
                href={pageHref(page - 1)}
                className="inline-flex h-8 items-center gap-1 rounded-lg border border-border bg-surface px-3 text-xs font-medium transition hover:bg-surface-raised"
              >
                <ChevronLeft className="h-3.5 w-3.5" /> Previous
              </Link>
            ) : null}
            {page < totalPages ? (
              <Link
                href={pageHref(page + 1)}
                className="inline-flex h-8 items-center gap-1 rounded-lg border border-border bg-surface px-3 text-xs font-medium transition hover:bg-surface-raised"
              >
                Next <ChevronRight className="h-3.5 w-3.5" />
              </Link>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
