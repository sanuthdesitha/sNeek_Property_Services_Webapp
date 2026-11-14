import { NextRequest } from "next/server";
import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { readPersonTours, resetPersonTours, updateTourPreference } from "@/lib/tutorials/store";
import { personPatchSchema } from "@/lib/tutorials/validation";
import { isSameOrigin, tourFailure, tourJson } from "@/lib/tutorials/http";

export const dynamic = "force-dynamic";

async function personOrNull(id: string) {
  return db.user.findUnique({ where: { id }, select: { id: true, name: true, email: true, role: true, createdAt: true } });
}

/** One person's tours (done / stopped at / not started) and their Show tours switch. */
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const person = await personOrNull(params.id);
    if (!person) return tourJson({ error: "Not found." }, 404);
    return tourJson({ person: { ...person, createdAt: person.createdAt.toISOString() }, ...(await readPersonTours(db, person.id)) });
  } catch (error) {
    return tourFailure(error);
  }
}

/** Administrators only: turn a person's tours on or off, or reset one or all of their tours. */
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  if (!isSameOrigin(req)) return tourJson({ error: "Same-origin request required." }, 403);
  try {
    const session = await requireRole([Role.ADMIN]);
    const input = personPatchSchema.parse(await req.json().catch(() => ({})));
    const person = await personOrNull(params.id);
    if (!person) return tourJson({ error: "Not found." }, 404);
    if (input.toursOn !== undefined) await updateTourPreference(db, person.id, { toursOn: input.toursOn }, session.user.id);
    const reset = input.reset ? await resetPersonTours(db, person.id, input.reset) : 0;
    return tourJson({ reset, ...(await readPersonTours(db, person.id)) });
  } catch (error) {
    return tourFailure(error);
  }
}
