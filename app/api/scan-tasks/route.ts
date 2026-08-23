import { NextRequest, NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { z } from "zod";
import { requireSession } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { resolveAppUrl } from "@/lib/app-url";
import { getAppSettings } from "@/lib/settings";
import { sendEmailDetailed } from "@/lib/notifications/email";

export const runtime = "nodejs";

/**
 * Asking somebody to go and count a property.
 *
 * The scan screens existed but nothing pointed at them, so a stock count
 * happened when a cleaner happened to think of it. This is the ask, and it is
 * the whole answer to "how does an admin get a count done?": pick the property,
 * pick the person, say what to look at, and they get an email with a link that
 * opens the scanner on that exact property.
 *
 * THE EMAIL CARRIES THE DEEP LINK, not directions to go and find the screen. A
 * task that makes the recipient work out where to go is a task that gets
 * postponed, and the postponement is invisible until a shelf is empty.
 */

const createSchema = z.object({
  propertyId: z.string().trim().min(1),
  assigneeId: z.string().trim().min(1),
  instructions: z.string().trim().max(4000).optional(),
  /** ISO date. Optional — "when you're next there" is a real answer. */
  dueAt: z.string().datetime().optional(),
});

export async function GET(req: NextRequest) {
  try {
    const session = await requireSession();
    const { searchParams } = new URL(req.url);
    const mine = searchParams.get("mine") === "1";

    const isOffice = session.user.role === Role.ADMIN || session.user.role === Role.OPS_MANAGER;

    const tasks = await db.scanTask.findMany({
      where: {
        cancelledAt: null,
        // Anyone who is not office staff sees only their own, whatever they
        // ask for. `mine` narrows an admin's view; it never widens anyone's.
        ...(mine || !isOffice ? { assigneeId: session.user.id } : {}),
        ...(searchParams.get("open") === "1" ? { completedAt: null } : {}),
      },
      orderBy: [{ completedAt: "asc" }, { dueAt: "asc" }, { createdAt: "desc" }],
      take: 200,
      select: {
        id: true,
        instructions: true,
        dueAt: true,
        startedAt: true,
        completedAt: true,
        completedByCountAt: true,
        createdAt: true,
        property: { select: { id: true, name: true, suburb: true } },
        assignee: { select: { id: true, name: true, email: true } },
        requestedBy: { select: { id: true, name: true } },
      },
    });

    return NextResponse.json({ tasks });
  } catch (err: any) {
    const status = err?.message === "UNAUTHORIZED" ? 401 : 400;
    return NextResponse.json({ error: "Could not load scan tasks." }, { status });
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await requireSession();
    const body = createSchema.parse(await req.json().catch(() => ({})));

    // Admins, ops and clients can ask. A cleaner assigning work to another
    // cleaner is not a workflow this business has.
    const mayAssign =
      session.user.role === Role.ADMIN ||
      session.user.role === Role.OPS_MANAGER ||
      session.user.role === Role.CLIENT ||
      session.user.role === Role.VA;
    if (!mayAssign) {
      return NextResponse.json({ error: "You cannot assign scans." }, { status: 403 });
    }

    const [property, assignee] = await Promise.all([
      db.property.findUnique({
        where: { id: body.propertyId },
        select: { id: true, name: true, suburb: true, clientId: true },
      }),
      db.user.findUnique({
        where: { id: body.assigneeId },
        select: { id: true, name: true, email: true, isActive: true },
      }),
    ]);

    if (!property) return NextResponse.json({ error: "Property not found." }, { status: 404 });
    if (!assignee || !assignee.isActive) {
      return NextResponse.json({ error: "That person cannot be assigned." }, { status: 404 });
    }

    // A client may only ask for counts of their OWN properties. Without this a
    // client could map the whole portfolio by assigning scans across it.
    if (session.user.role === Role.CLIENT || session.user.role === Role.VA) {
      const { requireClientPortal } = await import("@/lib/auth/client-portal");
      const portal = await requireClientPortal();
      if (property.clientId !== portal.clientId) {
        return NextResponse.json({ error: "That is not your property." }, { status: 403 });
      }
    }

    const task = await db.scanTask.create({
      data: {
        propertyId: property.id,
        assigneeId: assignee.id,
        requestedById: session.user.id,
        instructions: body.instructions?.trim() || null,
        dueAt: body.dueAt ? new Date(body.dueAt) : null,
      },
      select: { id: true, dueAt: true },
    });

    const notified = await notifyAssignee({
      task,
      assignee,
      property,
      requestedByName: session.user.name ?? "The office",
      instructions: body.instructions?.trim() || null,
      req,
    });

    if (notified) {
      await db.scanTask
        .update({ where: { id: task.id }, data: { notifiedAt: new Date() } })
        .catch(() => undefined);
    }

    return NextResponse.json({ task, notified }, { status: 201 });
  } catch (err: any) {
    const status = err?.message === "UNAUTHORIZED" ? 401 : err?.message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json({ error: "Could not assign that scan." }, { status });
  }
}

async function notifyAssignee(input: {
  task: { id: string; dueAt: Date | null };
  assignee: { name: string | null; email: string };
  property: { id: string; name: string | null; suburb: string | null };
  requestedByName: string;
  instructions: string | null;
  req: NextRequest;
}): Promise<boolean> {
  try {
    if (!input.assignee.email) return false;
    const settings = await getAppSettings();

    const place = [input.property.name, input.property.suburb].filter(Boolean).join(", ");
    // Straight into the scanner for that property. Telling somebody to "open
    // the app and find stock count" is how a task becomes next week's problem.
    // ?task= is what lets the destination know which ask it is answering — it
    // is how the count that follows gets credited back to this task instead of
    // leaving it outstanding forever.
    const url = resolveAppUrl(
      `/v2/cleaner/stock-count/${input.property.id}?task=${input.task.id}`,
      input.req,
    );
    const due = input.task.dueAt
      ? new Intl.DateTimeFormat("en-AU", {
          timeZone: "Australia/Sydney",
          day: "numeric",
          month: "short",
        }).format(input.task.dueAt)
      : null;

    await sendEmailDetailed({
      kind: "inventory_update",
      to: input.assignee.email,
      subject: `Stock count needed — ${place}`,
      html: [
        `<p>Hi ${input.assignee.name ?? "there"},</p>`,
        `<p>${input.requestedByName} has asked you to do a stock count at <strong>${place}</strong>${
          due ? `, by <strong>${due}</strong>` : ""
        }.</p>`,
        input.instructions
          ? `<p><strong>Notes:</strong> ${input.instructions.replace(/</g, "&lt;")}</p>`
          : "",
        `<p><a href="${url}">Open the scanner for this property</a></p>`,
        `<p>Scan every item in the cupboard — repeats are counted, so scan each bottle. You will get a summary to check and correct before anything is saved.</p>`,
        `<p>— ${settings.companyName}</p>`,
      ].join(""),
    });
    return true;
  } catch (err) {
    // The task is already created. A mail failure must not undo the assignment
    // — it means nobody was told, which `notifiedAt` records honestly.
    logger.error({ err }, "[scan-task] assignment email failed");
    return false;
  }
}
