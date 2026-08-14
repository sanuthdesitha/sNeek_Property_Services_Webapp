/**
 * CP-6 — admin multi-role assignment for a maintenance item.
 *
 *   GET  /api/admin/maintenance/:id/assignees        → { assignments, candidates }
 *   POST /api/admin/maintenance/:id/assignees        { role, userIds }
 *
 * One POST replaces the roster for ONE role, so saving the cleaner column can
 * never disturb who the QA inspector is. Newly-added people are emailed; the
 * send is best-effort and can never fail the assignment.
 */
import { NextRequest, NextResponse } from "next/server";
import { MaintenanceAssigneeRole, Role } from "@prisma/client";
import { formatInTimeZone } from "date-fns-tz";
import { z } from "zod";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { getAppSettings } from "@/lib/settings";
import { resolveAppUrl } from "@/lib/app-url";
import { sendEmailDetailed } from "@/lib/notifications/email";
import { buildMaintenanceAssignedEmail } from "@/lib/maintenance/assignment-email";
import {
  MAINTENANCE_ASSIGNEE_ROLE_LABELS,
  MAINTENANCE_SECTION_HREF,
} from "@/lib/maintenance/assignment-roles";
import {
  listAllAssignableUsers,
  listItemAssignments,
  markAssigneesNotified,
  setItemAssignees,
} from "@/lib/maintenance/assignments";
import { PRIORITY_LABELS } from "@/lib/maintenance/labels";

const TZ = "Australia/Sydney";

const schema = z.object({
  role: z.nativeEnum(MaintenanceAssigneeRole),
  userIds: z.array(z.string().trim().min(1)).max(50),
});

function errStatus(message: string) {
  return message === "UNAUTHORIZED" ? 401 : message === "FORBIDDEN" ? 403 : 400;
}

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const [assignments, candidates] = await Promise.all([
      listItemAssignments(params.id),
      listAllAssignableUsers(),
    ]);
    return NextResponse.json({ assignments, candidates });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: errStatus(err.message) });
  }
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const body = schema.parse(await req.json());

    const diff = await setItemAssignees({
      itemId: params.id,
      role: body.role,
      userIds: body.userIds,
      assignedByUserId: session.user.id,
    });

    // The assignment is now committed. Everything below is notification, and a
    // notification failure must never undo or fail it — house rule.
    if (diff.added.length > 0) {
      await notifyNewAssignees({
        req,
        itemId: params.id,
        role: body.role,
        userIds: diff.added,
      }).catch((err) => {
        logger.error(
          { err, itemId: params.id, role: body.role, userIds: diff.added },
          "CP-6: maintenance assignment emails failed; assignment itself is unaffected"
        );
      });
    }

    const assignments = await listItemAssignments(params.id);
    return NextResponse.json({ ok: true, ...diff, assignments });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: errStatus(err.message) });
  }
}

/**
 * Email everyone newly added to one role. Wrapped end-to-end by the caller's
 * catch, and per-recipient here too, so one bad address cannot silence the rest.
 */
async function notifyNewAssignees(input: {
  req: NextRequest;
  itemId: string;
  role: MaintenanceAssigneeRole;
  userIds: string[];
}): Promise<void> {
  const item = await db.propertyMaintenanceItem.findUnique({
    where: { id: input.itemId },
    select: {
      id: true,
      title: true,
      priority: true,
      scheduledFor: true,
      property: { select: { name: true, suburb: true } },
    },
  });
  if (!item) return;

  const [settings, users] = await Promise.all([
    getAppSettings(),
    db.user.findMany({
      where: { id: { in: input.userIds } },
      select: { id: true, name: true, email: true },
    }),
  ]);

  const propertyName = `${item.property?.name ?? "Property"}${
    item.property?.suburb ? ` (${item.property.suburb})` : ""
  }`;
  const scheduledFor = item.scheduledFor
    ? formatInTimeZone(item.scheduledFor, TZ, "d MMM yyyy, h:mm a")
    : null;
  const actionUrl = resolveAppUrl(MAINTENANCE_SECTION_HREF[input.role], input.req);
  const roleLabel = MAINTENANCE_ASSIGNEE_ROLE_LABELS[input.role];

  const notified: string[] = [];
  for (const user of users) {
    if (!user.email) continue;
    try {
      const email = buildMaintenanceAssignedEmail(
        { companyName: settings.companyName, logoUrl: settings.logoUrl },
        {
          userName: user.name ?? user.email,
          roleLabel,
          itemTitle: item.title,
          propertyName,
          priorityLabel: PRIORITY_LABELS[item.priority] ?? item.priority,
          scheduledFor,
          actionUrl,
        }
      );
      const result = await sendEmailDetailed({
        kind: "job_assignment",
        to: user.email,
        subject: email.subject,
        html: email.html,
      });
      if (result.ok) notified.push(user.id);
      else {
        logger.warn(
          { itemId: input.itemId, role: input.role, userId: user.id, error: result.error },
          "CP-6: maintenance assignment email not delivered"
        );
      }
    } catch (err) {
      logger.error(
        { err, itemId: input.itemId, role: input.role, userId: user.id },
        "CP-6: maintenance assignment email threw; continuing with the rest"
      );
    }
  }

  if (notified.length > 0) {
    await markAssigneesNotified({ itemId: input.itemId, role: input.role, userIds: notified }).catch(
      (err) => logger.error({ err, itemId: input.itemId }, "CP-6: could not stamp notifiedAt")
    );
  }
}
