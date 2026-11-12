import { NextRequest } from "next/server";
import { Role } from "@prisma/client";
import { z } from "zod";
import { requireRole } from "@/lib/auth/session";
import { publishRules } from "@/lib/scheduling-rules/service";
import { noStore, rulesErrorResponse } from "@/lib/scheduling-rules/http";

const schema = z.object({
  token: z.string().min(1),
  credentials: z.object({ pin: z.string().max(32).optional(), password: z.string().max(200).optional(), newPin: z.string().max(32).optional() }).strict(),
  values: z.unknown(),
  effectiveFrom: z.string(),
  reason: z.string(),
  expectedLatestVersion: z.number().int().positive(),
  appliesToExisting: z.boolean(),
  confirmed: z.boolean(),
  kind: z.enum(["EDIT", "RESTORE", "IMPORT"]),
  restoredFromVersion: z.number().int().positive().nullable().optional(),
}).strict();

/** Publish a new version (edit, restore or import): unlock + PIN again + reason + confirm. */
export async function POST(req: NextRequest) {
  try {
    const session = await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const body = schema.parse(await req.json());
    return noStore(await publishRules(session, body));
  } catch (error) {
    return rulesErrorResponse(error);
  }
}
