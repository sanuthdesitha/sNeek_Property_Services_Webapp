import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireSession } from "@/lib/auth/session";
import { getOpsAccess } from "@/lib/rbac/ops-access";
import { isOpsSubject } from "@/lib/rbac/ops-policy";
import { opsRequestFeature } from "@/lib/rbac/ops-catalog";
import { isSameOrigin } from "@/lib/inventory/urgent-stock-http";
import { isOpsFeature, officePageName } from "@/lib/access/denial";
import { displayFromPath, safeFromPath } from "@/lib/access/return-path";
import { requestAreaAccess } from "@/lib/access/access-request";

/**
 * POST /api/admin/access-requests { area, from? }: "Ask an administrator…"
 * from the access-denied page (board "Access denied"). Inbox only, at most
 * once per person per area per organisation day, never while testing as
 * someone, and only for an area the person's live access really refuses.
 * It grants nothing.
 */
const headers = { "Cache-Control": "private, no-store" };
const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers });

const schema = z.object({
  area: z.string().trim().min(1).max(64),
  from: z.string().max(1024).nullish(),
});

export async function POST(req: NextRequest) {
  if (!isSameOrigin(req)) return json({ error: "Same-origin request required." }, 403);
  let session;
  try {
    session = await requireSession();
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    return message === "FORBIDDEN" ? json({ error: "Your access does not include this." }, 403) : json({ error: "Sign in again." }, 401);
  }
  if (session.impersonation) {
    return json({ error: "Not while testing as someone: the request would be sent in their name." }, 403);
  }
  const held = (session.user.heldRoles ?? [session.user.role]).map(String);
  if (!isOpsSubject({ role: String(session.user.role), heldRoles: held })) {
    return json({ error: "Only office staff whose access leaves an area out can ask for it." }, 403);
  }
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success || !isOpsFeature(parsed.data.area)) {
    return json({ error: "Choose an area of the office to ask for." }, 400);
  }
  const area = parsed.data.area;

  let levels;
  try {
    levels = await getOpsAccess({ id: session.user.id, role: String(session.user.role), heldRoles: held });
  } catch {
    return json({ error: "your access could not be checked just now. Nothing was sent; try again in a moment." }, 503);
  }
  if (!levels || levels[area] === "manage") {
    return json({ error: "Your access already includes this area. Nothing was sent." }, 409);
  }

  // The page they came from is named only when it belongs to the area asked for.
  const from = safeFromPath(parsed.data.from ?? null);
  const fromMatches = from !== null && opsRequestFeature(from) === area;
  let result;
  try {
    result = await requestAreaAccess({
      requester: { id: session.user.id, name: session.user.name ?? null, email: session.user.email ?? null },
      area,
      fromPage: fromMatches ? officePageName(from) : null,
      fromPath: fromMatches ? displayFromPath(from) : null,
    });
  } catch {
    return json({ error: "it could not be recorded just now. Nothing was sent; try again in a moment." }, 503);
  }
  if (!result.ok) return json({ error: result.error }, result.status);
  return json({ outcome: result.outcome });
}
