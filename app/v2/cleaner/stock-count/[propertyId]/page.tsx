import { notFound } from "next/navigation";
import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { StockCountRun } from "@/components/v2/cleaner/stock-count-run";

/**
 * The scanned stock count for one property.
 *
 * Dynamic because it opens a camera and writes stock — there is nothing worth
 * caching, and a stale property name on the one screen a cleaner uses to check
 * they are in the right cupboard would be a small lie in an expensive place.
 */
export const dynamic = "force-dynamic";

const SYDNEY_TZ = "Australia/Sydney";

export default async function StockCountPage({
  params,
  searchParams,
}: {
  params: { propertyId: string };
  searchParams?: { task?: string };
}) {
  // Laundry staff hold stock too, so they are not excluded here.
  const session = await requireRole([Role.CLEANER, Role.LAUNDRY, Role.ADMIN, Role.OPS_MANAGER]);

  const taskId = searchParams?.task?.trim() || null;
  const [property, task] = await Promise.all([
    db.property.findUnique({
      where: { id: params.propertyId },
      select: { id: true, name: true, suburb: true },
    }),
    taskId
      ? db.scanTask.findFirst({
          // Scoped to BOTH the signed-in assignee and the property in the URL.
          // ?task= is a guessable id in an emailed link, and a plain findUnique
          // would show one person the instructions, due date and requester of
          // somebody else's task.
          where: {
            id: taskId,
            assigneeId: session.user.id,
            propertyId: params.propertyId,
            cancelledAt: null,
          },
          select: {
            id: true,
            instructions: true,
            dueAt: true,
            startedAt: true,
            completedAt: true,
            requestedBy: { select: { name: true } },
          },
        })
      : Promise.resolve(null),
  ]);
  if (!property) notFound();

  // "They opened it" is the only signal that separates a task being ignored
  // from a task being worked on, and nothing else in the app writes startedAt.
  // Failing to stamp it must not cost the cleaner the screen, so the write is
  // not allowed to take the page down with it.
  if (task && !task.startedAt) {
    await db.scanTask
      .update({ where: { id: task.id }, data: { startedAt: new Date() } })
      .catch(() => undefined);
  }

  const dueLabel = task?.dueAt
    ? new Intl.DateTimeFormat("en-AU", {
        timeZone: SYDNEY_TZ,
        weekday: "short",
        day: "numeric",
        month: "short",
      }).format(task.dueAt)
    : null;

  return (
    <div className="mx-auto w-full max-w-lg px-4 py-4">
      {task ? (
        <div className="mb-4 rounded-[var(--e-radius-lg)] border-l-[3px] border-[hsl(var(--e-info))] bg-[hsl(var(--e-info-soft))] p-4">
          <p className="text-[0.875rem] font-semibold text-[hsl(var(--e-foreground))]">
            {task.requestedBy?.name?.trim() || "The office"} asked you to count this property
          </p>
          {task.instructions ? (
            <p className="mt-1 whitespace-pre-wrap text-[0.8125rem] text-[hsl(var(--e-text-secondary))]">
              {task.instructions}
            </p>
          ) : null}
          <p className="mt-1.5 text-[0.75rem] text-[hsl(var(--e-text-secondary))]">
            {dueLabel ? `Due ${dueLabel}.` : "No due date — whenever you are next here."}
            {task.completedAt ? " Already marked done." : ""}
          </p>
        </div>
      ) : null}

      <StockCountRun
        propertyId={property.id}
        propertyName={[property.name, property.suburb].filter(Boolean).join(" · ")}
        taskId={task?.id ?? null}
      />
    </div>
  );
}
