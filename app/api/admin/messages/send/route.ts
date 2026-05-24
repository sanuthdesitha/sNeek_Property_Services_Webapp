import { NextRequest, NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { z } from "zod";
import { requireRole } from "@/lib/auth/session";
import { resolveTemplate, type VariableContext } from "@/lib/messages/variables";
import { sendEmailDetailed } from "@/lib/notifications/email";
import { sendSmsDetailed } from "@/lib/notifications/sms";

const schema = z.object({
  templateId: z.string().optional(),
  channel: z.enum(["EMAIL", "SMS"]),
  recipientUserId: z.string().optional(),
  recipientEmail: z.string().email().optional(),
  recipientPhone: z.string().optional(),
  subject: z.string().optional(),
  body: z.string().min(1, "Body is required"),
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

  let payload: unknown;
  try {
    payload = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = schema.safeParse(payload);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid input", details: parsed.error.format() },
      { status: 400 },
    );
  }

  const { channel, recipientEmail, recipientPhone, subject, body, context } =
    parsed.data;

  const ctx: VariableContext = {
    client: context?.clientId ? { id: context.clientId } : undefined,
    cleaner: context?.cleanerId ? { id: context.cleanerId } : undefined,
    job: context?.jobId ? { id: context.jobId } : undefined,
    property: context?.propertyId ? { id: context.propertyId } : undefined,
    quote: context?.quoteId ? { id: context.quoteId } : undefined,
  };

  const resolvedBody = await resolveTemplate(body, ctx);
  const resolvedSubject = subject
    ? await resolveTemplate(subject, ctx)
    : undefined;

  if (channel === "EMAIL") {
    if (!recipientEmail) {
      return NextResponse.json(
        { error: "Email recipient required" },
        { status: 400 },
      );
    }
    const result = await sendEmailDetailed({
      to: recipientEmail,
      subject: resolvedSubject ?? "(no subject)",
      html: resolvedBody.replace(/\n/g, "<br/>"),
    });
    return NextResponse.json({
      ok: result.ok,
      channel: "EMAIL",
      externalId: result.externalId ?? null,
      error: result.error,
      skipped: result.skipped ?? false,
      resolvedSubject,
      resolvedBody,
    });
  }

  // SMS
  if (!recipientPhone) {
    return NextResponse.json(
      { error: "Phone recipient required" },
      { status: 400 },
    );
  }
  const smsResult = await sendSmsDetailed(recipientPhone, resolvedBody);
  return NextResponse.json({
    ok: smsResult.ok,
    channel: "SMS",
    provider: smsResult.provider,
    status: smsResult.status,
    error: smsResult.error,
    resolvedBody,
  });
}
