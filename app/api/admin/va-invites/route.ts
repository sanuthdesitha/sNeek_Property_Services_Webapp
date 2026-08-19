import { NextRequest, NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { z } from "zod";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { createVaTeam, inviteVaMember, listVaTeams } from "@/lib/va/teams";
import {
  vaPermissionsInputSchema,
  parseVaPermissions,
  parseVaPropertyScope,
} from "@/lib/va/permissions";
import { sendEmailDetailed } from "@/lib/notifications/email";
import { getAppSettings } from "@/lib/settings";
import { resolveAppUrl } from "@/lib/app-url";
import { getValidationErrorMessage } from "@/lib/validations/errors";
import { logger } from "@/lib/logger";

/**
 * Admin invites one or more VAs to act on behalf of a client.
 *
 * Bulk by design: an agency onboards an assistant team in one sitting, and the
 * client should receive ONE "these people now have access" email rather than a
 * trickle of five. That single notification is the point — the client is being
 * told about delegated access to their own properties, so it has to arrive as
 * one legible list.
 *
 * A VA is ALWAYS linked to a client. There is no unattached VA: a VA's client
 * is resolved from `vaTeam.clientId` by requireClientPortal(), which
 * deliberately refuses to fall back to `user.clientId`. Picking the client here
 * therefore means picking the TEAM's client.
 *
 * This route is a thin wrapper over lib/va/teams.ts on purpose. The client
 * portal already creates teams and invites members through those helpers; a
 * second implementation here would be the same duplication that let the
 * property access-info bug diverge between two copies of one rule.
 *
 * PERMISSIONS: an admin may set a STARTING set when creating a NEW team, so an
 * assistant is useful on day one. Adding members to an EXISTING team never
 * touches its grants — those belong to the client, who may have deliberately
 * narrowed them, and an admin adding a sixth assistant must not silently
 * re-widen the team.
 */

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

const memberSchema = z.object({
  name: z.string().trim().max(120).optional(),
  email: z.string().trim().toLowerCase().email("Enter a valid email address."),
});

const inviteSchema = z
  .object({
    clientId: z.string().trim().min(1, "Select the client this assistant works for."),
    /** Add to an existing team... */
    teamId: z.string().trim().min(1).optional(),
    /** ...or name a new one. */
    teamName: z.string().trim().min(1).max(120).optional(),
    /** Starting grants. Honoured only when creating a NEW team. */
    permissions: vaPermissionsInputSchema.optional(),
    /** Starting property scope. Empty/absent means every property. */
    propertyIds: z.array(z.string().trim().min(1)).optional(),
    members: z.array(memberSchema).min(1, "Add at least one assistant.").max(20),
  })
  .superRefine((value, ctx) => {
    if (!value.teamId && !value.teamName) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Choose an existing team or name a new one.",
        path: ["teamName"],
      });
    }
  });

/**
 * Teams and properties for one client, so the invite screen can offer
 * "add to an existing team" instead of forcing a new team every time — and can
 * scope a NEW team to a subset of properties.
 */
export async function GET(req: NextRequest) {
  try {
    await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const clientId = req.nextUrl.searchParams.get("clientId")?.trim();
    if (!clientId) {
      return NextResponse.json({ teams: [], properties: [] });
    }

    const [teams, properties] = await Promise.all([
      listVaTeams(clientId),
      db.property.findMany({
        where: { clientId },
        select: { id: true, name: true },
        orderBy: { name: "asc" },
      }),
    ]);

    // Grants go through the SAME parsers the auth chokepoint uses, so the
    // admin screen shows exactly what would be enforced — never a looser
    // reading of a malformed blob.
    return NextResponse.json({
      teams: teams.map((t) => ({
        id: t.id,
        name: t.name,
        isActive: t.isActive,
        memberCount: t.members.length,
        permissions: parseVaPermissions(t.permissions),
        propertyIds: parseVaPropertyScope(t.propertyIds),
        members: t.members.map((m) => ({
          id: m.id,
          name: m.name,
          email: m.email,
          isActive: m.isActive,
          acceptedAt: m.invitation?.acceptedAt?.toISOString() ?? null,
        })),
      })),
      properties,
    });
  } catch (err: any) {
    const status = err.message === "UNAUTHORIZED" ? 401 : err.message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json({ error: "Could not load assistant teams." }, { status });
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const body = inviteSchema.parse(await req.json());

    const client = await db.client.findUnique({
      where: { id: body.clientId },
      select: { id: true, name: true, email: true, isActive: true },
    });
    if (!client || !client.isActive) {
      return NextResponse.json(
        { error: "Selected client does not exist or is inactive." },
        { status: 400 }
      );
    }

    // Reject duplicates WITHIN the batch first. inviteVaMember treats a repeat
    // as a resend, so a duplicated row would quietly send the same person two
    // invitations and report both as successes.
    const seen = new Set<string>();
    const duplicates: string[] = [];
    for (const member of body.members) {
      if (seen.has(member.email)) duplicates.push(member.email);
      seen.add(member.email);
    }
    if (duplicates.length > 0) {
      return NextResponse.json(
        { error: `Repeated email in this invite: ${Array.from(new Set(duplicates)).join(", ")}` },
        { status: 400 }
      );
    }

    let teamId: string;
    let teamName: string;
    let createdTeam = false;

    if (body.teamId) {
      const existingTeam = await db.vaTeam.findUnique({
        where: { id: body.teamId },
        select: { id: true, name: true, clientId: true },
      });
      // A team belonging to ANOTHER client would silently widen that client's
      // exposure to people they never approved.
      if (!existingTeam || existingTeam.clientId !== client.id) {
        return NextResponse.json(
          { error: "That assistant team does not belong to this client." },
          { status: 400 }
        );
      }
      teamId = existingTeam.id;
      teamName = existingTeam.name;
    } else {
      const team = await createVaTeam({
        clientId: client.id,
        createdById: session.user.id,
        name: body.teamName as string,
        permissions: body.permissions,
        propertyIds: body.propertyIds,
      });
      teamId = team.id;
      teamName = team.name;
      createdTeam = true;
    }

    // Per member, so one bad address cannot cost the rest their invitations.
    // EMAIL_IN_USE means the address belongs to some other account entirely —
    // re-pointing a live login at this team would be an account takeover, which
    // inviteVaMember refuses.
    const results: Array<{
      email: string;
      name?: string;
      ok: boolean;
      emailed?: boolean;
      error?: string;
    }> = [];

    for (const member of body.members) {
      try {
        const result = await inviteVaMember({
          clientId: client.id,
          teamId,
          email: member.email,
          name: member.name,
          invitedById: session.user.id,
        });
        results.push({
          email: member.email,
          name: member.name,
          ok: true,
          emailed: (result as { emailSent?: boolean }).emailSent !== false,
        });
      } catch (err: any) {
        const message =
          err?.message === "EMAIL_IN_USE"
            ? "Already used by another account."
            : err?.message ?? "Could not invite.";
        results.push({ email: member.email, name: member.name, ok: false, error: message });
        logger.error({ err, email: member.email, teamId }, "VA invite failed");
      }
    }

    const invited = results.filter((r) => r.ok);

    await db.auditLog.create({
      data: {
        userId: session.user.id,
        action: "CREATE_VA_INVITES",
        entity: "VaTeam",
        entityId: teamId,
        after: {
          clientId: client.id,
          teamName,
          newTeam: createdTeam,
          invited: invited.map((r) => r.email),
          failed: results.filter((r) => !r.ok).map((r) => ({ email: r.email, error: r.error })),
        } as any,
      },
    });

    // ONE notification to the client, listing everyone who actually got in.
    // Best-effort: the accounts exist and the invitations are out whether or
    // not this lands. Skipped entirely when nobody was invited.
    let clientNotified = false;
    let clientNotifyError: string | undefined;
    const clientEmail = client.email?.trim();

    if (invited.length === 0) {
      clientNotifyError = "No assistants were invited, so the client was not notified.";
    } else if (!clientEmail) {
      clientNotifyError = "This client has no email address on file.";
    } else {
      try {
        const settings = await getAppSettings();
        const rows = invited
          .map((r) => `<li>${escapeHtml(r.name || r.email)} (${escapeHtml(r.email)})</li>`)
          .join("");
        const manageUrl = resolveAppUrl("/v2/client/team", req);
        const plural = invited.length === 1 ? "" : "s";
        const grantLine = createdTeam
          ? "<p>You can change what they are allowed to do at any time.</p>"
          : "<p>They inherit the permissions already set on that team.</p>";
        const sent = await sendEmailDetailed({
          to: [clientEmail],
          subject: `${settings.companyName} - assistant access added to your account`,
          html: `
            <p>We have set up portal access for the following assistant${plural}, on the team <strong>${escapeHtml(teamName)}</strong>:</p>
            <ul>${rows}</ul>
            ${grantLine}
            <p>Manage their access here: <a href="${manageUrl}">${manageUrl}</a></p>
            <p>Assistants can never approve quotes or extras, approve costs, or pay invoices. Those stay with you.</p>
          `,
          transactional: true,
        });
        clientNotified = sent.ok;
        clientNotifyError = sent.ok ? undefined : sent.error;
      } catch (err: any) {
        clientNotifyError = err?.message ?? "Client notification failed.";
        logger.error({ err, clientId: client.id }, "VA invite client notification failed");
      }
    }

    return NextResponse.json(
      {
        ok: invited.length > 0,
        teamId,
        teamName,
        createdTeam,
        invited: invited.length,
        results,
        clientNotified,
        clientNotifyError,
      },
      { status: invited.length > 0 ? 201 : 400 }
    );
  } catch (err: any) {
    const status = err.message === "UNAUTHORIZED" ? 401 : err.message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json(
      { error: getValidationErrorMessage(err, "Could not invite assistants.") },
      { status }
    );
  }
}
