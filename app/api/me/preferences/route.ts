import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireSession } from "@/lib/auth/session";
import { db } from "@/lib/db";

const schema = z.object({
  uiDensity: z.enum(["COMPACT", "DEFAULT", "COMFORTABLE"]).optional(),
  themePreference: z.enum(["LIGHT", "DARK", "SYSTEM"]).optional(),
  invoicingCadence: z
    .enum(["ON_COMPLETION", "WEEKLY", "FORTNIGHTLY", "MONTHLY", "CUSTOM"])
    .optional(),
  invoiceDayOfWeek: z.number().int().min(0).max(6).nullable().optional(),
  invoiceDayOfMonth: z.number().int().min(1).max(28).nullable().optional(),
  preferredPayoutMethod: z
    .enum(["STRIPE_CONNECT", "ABA_FILE", "MANUAL_BANK_TRANSFER", "PAYPAL"])
    .optional(),
  preferredTransport: z.enum(["DRIVING", "WALKING", "TRANSIT", "BICYCLING"]).optional(),
});

export async function POST(req: NextRequest) {
  try {
    const session = await requireSession();
    const body = await req.json();
    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid", details: parsed.error.format() },
        { status: 400 }
      );
    }
    const user = await db.user.update({
      where: { id: session.user.id },
      data: parsed.data as any,
      select: {
        uiDensity: true,
        themePreference: true,
        invoicingCadence: true,
        invoiceDayOfWeek: true,
        invoiceDayOfMonth: true,
        preferredPayoutMethod: true,
        preferredTransport: true,
      } as any,
    });
    return NextResponse.json(user);
  } catch (err: any) {
    const status = err?.message === "UNAUTHORIZED" ? 401 : 400;
    return NextResponse.json({ error: err?.message ?? "Bad request" }, { status });
  }
}
