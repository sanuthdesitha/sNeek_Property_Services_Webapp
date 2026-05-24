import { NextRequest, NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { z } from "zod";
import { requireRole } from "@/lib/auth/session";
import { resolveTemplate, type VariableContext } from "@/lib/messages/variables";

const schema = z.object({
  subject: z.string().optional(),
  body: z.string().default(""),
  context: z
    .object({
      clientId: z.string().optional(),
      cleanerId: z.string().optional(),
      jobId: z.string().optional(),
      propertyId: z.string().optional(),
      quoteId: z.string().optional(),
    })
    .optional(),
});

export async function POST(req: NextRequest) {
  try {
    await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
  } catch {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid input", details: parsed.error.format() },
      { status: 400 },
    );
  }

  const { subject, body, context } = parsed.data;
  const ctx: VariableContext = {
    client: context?.clientId ? { id: context.clientId } : undefined,
    cleaner: context?.cleanerId ? { id: context.cleanerId } : undefined,
    job: context?.jobId ? { id: context.jobId } : undefined,
    property: context?.propertyId ? { id: context.propertyId } : undefined,
    quote: context?.quoteId ? { id: context.quoteId } : undefined,
  };

  const [resolvedSubject, resolvedBody] = await Promise.all([
    subject ? resolveTemplate(subject, ctx) : Promise.resolve(undefined),
    resolveTemplate(body, ctx),
  ]);

  return NextResponse.json({
    subject: resolvedSubject,
    body: resolvedBody,
  });
}
