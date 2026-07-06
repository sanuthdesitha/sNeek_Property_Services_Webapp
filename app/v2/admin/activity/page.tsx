import Link from "next/link";
import { format } from "date-fns";
import { toZonedTime } from "date-fns-tz";
import { Role, Prisma } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";
import {
  EBadge,
  ECard,
  ECardBody,
  EEmptyState,
  EPageHeader,
} from "@/components/v2/ui/primitives";
import { ChevronLeft, ChevronRight, History } from "lucide-react";

export const metadata = { title: "Activity · Estate admin" };
export const dynamic = "force-dynamic";

const TZ = "Australia/Sydney";
const PAGE_SIZE = 50;

type SearchParams = {
  entity?: string;
  q?: string;
  user?: string;
  page?: string;
};

export default async function V2AdminActivityPage({
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
    db.auditLog
      .findMany({
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
      })
      .catch(() => []),
    db.auditLog.count({ where }).catch(() => 0),
    db.auditLog
      .findMany({
        distinct: ["entity"],
        select: { entity: true },
        orderBy: { entity: "asc" },
        take: 100,
      })
      .catch(() => []),
  ]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const baseQuery = new URLSearchParams();
  if (entity) baseQuery.set("entity", entity);
  if (q) baseQuery.set("q", q);
  if (userQuery) baseQuery.set("user", userQuery);
  const pageHref = (p: number) => {
    const params = new URLSearchParams(baseQuery);
    params.set("page", String(p));
    return `/v2/admin/activity?${params.toString()}`;
  };

  const inputCls =
    "h-9 w-full rounded-[var(--e-radius)] border border-[hsl(var(--e-input))] bg-[hsl(var(--e-surface))] px-3 text-[0.8125rem] text-[hsl(var(--e-foreground))] placeholder:text-[hsl(var(--e-muted-foreground))] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--e-ring))] sm:max-w-xs";

  return (
    <div className="space-y-6">
      <EPageHeader
        eyebrow="Governance"
        title="Activity log"
        description="Every audited action across the platform — who changed what, and when."
        actions={
          <p className="text-[0.75rem] tabular-nums text-[hsl(var(--e-muted-foreground))]">
            {total.toLocaleString()} entries
          </p>
        }
      />

      {/* Filters */}
      <form method="GET" className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <input type="search" name="q" defaultValue={q ?? ""} placeholder="Search actions…" className={inputCls} />
        <input
          type="search"
          name="user"
          defaultValue={userQuery ?? ""}
          placeholder="Filter by user name or email…"
          className={inputCls}
        />
        <select
          name="entity"
          defaultValue={entity ?? ""}
          className="h-9 rounded-[var(--e-radius)] border border-[hsl(var(--e-input))] bg-[hsl(var(--e-surface))] px-3 text-[0.8125rem] text-[hsl(var(--e-foreground))] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--e-ring))]"
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
          className="h-9 rounded-[var(--e-radius)] bg-[hsl(var(--e-primary))] px-4 text-[0.8125rem] font-[550] text-[hsl(var(--e-primary-foreground))] transition-colors hover:bg-[hsl(var(--e-primary-hover))]"
        >
          Apply
        </button>
        {(entity || q || userQuery) && (
          <Link
            href="/v2/admin/activity"
            className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))] hover:text-[hsl(var(--e-foreground))] hover:underline"
          >
            Clear filters
          </Link>
        )}
      </form>

      {/* Entries */}
      {entries.length === 0 ? (
        <EEmptyState
          eyebrow="Nothing logged"
          title="No audit entries"
          description="No audited actions match the current filters."
        />
      ) : (
        <ECard>
          <ECardBody className="p-0">
            <div className="divide-y divide-[hsl(var(--e-border))]">
              {entries.map((entry) => {
                const hasDiff = entry.before != null || entry.after != null;
                return (
                  <details key={entry.id} className="group">
                    <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 transition-colors hover:bg-[hsl(var(--e-muted))] sm:px-6 [&::-webkit-details-marker]:hidden">
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[0.8125rem] text-[hsl(var(--e-foreground))]">
                          <span className="font-[550]">{entry.user?.name ?? "System"}</span>{" "}
                          <span className="text-[hsl(var(--e-muted-foreground))]">
                            {entry.action.replace(/[._]/g, " ").toLowerCase()}
                          </span>
                        </p>
                        <p className="mt-0.5 truncate text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
                          {entry.user?.email ?? ""}
                          {entry.ipAddress ? ` · ${entry.ipAddress}` : ""}
                        </p>
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        <EBadge tone="neutral">{entry.entity}</EBadge>
                        {entry.jobId ? (
                          <Link
                            href={`/v2/admin/jobs/${entry.jobId}`}
                            className="text-[0.75rem] text-[hsl(var(--e-accent-portal))] hover:underline"
                          >
                            Job →
                          </Link>
                        ) : null}
                        <span className="text-[0.75rem] tabular-nums text-[hsl(var(--e-muted-foreground))]">
                          {format(toZonedTime(entry.createdAt, TZ), "d MMM yyyy · HH:mm:ss")}
                        </span>
                      </div>
                    </summary>
                    {hasDiff ? (
                      <div className="grid gap-3 border-t border-[hsl(var(--e-border)/0.6)] bg-[hsl(var(--e-surface-raised)/0.5)] px-4 py-3 sm:grid-cols-2 sm:px-6">
                        <div>
                          <p className="mb-1 e-eyebrow">Before</p>
                          <pre className="max-h-64 overflow-auto rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface))] p-3 text-[0.6875rem] leading-relaxed text-[hsl(var(--e-muted-foreground))]">
                            {entry.before != null ? JSON.stringify(entry.before, null, 2) : "—"}
                          </pre>
                        </div>
                        <div>
                          <p className="mb-1 e-eyebrow">After</p>
                          <pre className="max-h-64 overflow-auto rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface))] p-3 text-[0.6875rem] leading-relaxed text-[hsl(var(--e-muted-foreground))]">
                            {entry.after != null ? JSON.stringify(entry.after, null, 2) : "—"}
                          </pre>
                        </div>
                      </div>
                    ) : (
                      <p className="border-t border-[hsl(var(--e-border)/0.6)] bg-[hsl(var(--e-surface-raised)/0.5)] px-4 py-3 text-[0.75rem] text-[hsl(var(--e-muted-foreground))] sm:px-6">
                        No payload recorded for this action. Entity ID:{" "}
                        <span className="font-mono">{entry.entityId}</span>
                      </p>
                    )}
                  </details>
                );
              })}
            </div>
          </ECardBody>
        </ECard>
      )}

      {/* Pagination */}
      {totalPages > 1 ? (
        <div className="flex items-center justify-between">
          <p className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
            Page {page} of {totalPages}
          </p>
          <div className="flex gap-2">
            {page > 1 ? (
              <Link
                href={pageHref(page - 1)}
                className="inline-flex h-8 items-center gap-1 rounded-[var(--e-radius)] border border-[hsl(var(--e-border-strong))] bg-[hsl(var(--e-surface))] px-3 text-[0.75rem] font-[550] transition-colors hover:bg-[hsl(var(--e-muted))]"
              >
                <ChevronLeft className="h-3.5 w-3.5" /> Previous
              </Link>
            ) : null}
            {page < totalPages ? (
              <Link
                href={pageHref(page + 1)}
                className="inline-flex h-8 items-center gap-1 rounded-[var(--e-radius)] border border-[hsl(var(--e-border-strong))] bg-[hsl(var(--e-surface))] px-3 text-[0.75rem] font-[550] transition-colors hover:bg-[hsl(var(--e-muted))]"
              >
                Next <ChevronRight className="h-3.5 w-3.5" />
              </Link>
            ) : null}
          </div>
        </div>
      ) : null}

      <p className="text-[0.75rem] text-[hsl(var(--e-text-faint))]">Estate preview · live data from your workspace.</p>
    </div>
  );
}
