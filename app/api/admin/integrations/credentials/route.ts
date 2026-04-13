import { NextRequest, NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";

const CREDENTIAL_KEY = "integrationCredentials";

const DEFAULTS = {
  // Email
  resendApiKey: "",
  emailFrom: "",

  // SMS – Twilio
  twilioAccountSid: "",
  twilioAuthToken: "",
  twilioPhoneNumber: "",

  // SMS – Cellcast
  cellcastAppKey: "",
  cellcastFrom: "",

  // Storage – S3 / R2
  s3BucketName: "",
  s3Region: "",
  s3Endpoint: "",
  awsAccessKeyId: "",
  awsSecretAccessKey: "",
  s3PublicBaseUrl: "",

  // Payments – Stripe
  stripeSecretKey: "",
  stripeWebhookSecret: "",

  // Payments – Square
  squareAccessToken: "",
  squareLocationId: "",

  // Payments – PayPal
  paypalClientId: "",
  paypalClientSecret: "",
  paypalSandbox: false,

  // Xero
  xeroClientId: "",
  xeroClientSecret: "",

  // Maps
  googleMapsApiKey: "",

  // Bootstrap admin
  bootstrapAdminEmail: "",
  bootstrapAdminPassword: "",
  bootstrapAdminName: "",
};

type IntegrationCredentials = typeof DEFAULTS;

export async function GET() {
  try {
    await requireRole([Role.ADMIN]);
    const row = await db.appSetting.findUnique({ where: { key: CREDENTIAL_KEY } });
    const creds = row ? { ...DEFAULTS, ...(row.value as Partial<IntegrationCredentials>) } : DEFAULTS;

    // Mask sensitive fields: show first 4 + last 4 chars, mask middle
    const masked: Record<string, string | boolean> = {};
    for (const [key, value] of Object.entries(creds)) {
      if (typeof value === "boolean") {
        masked[key] = value;
      } else if (typeof value === "string" && value.length > 8) {
        masked[key] = `${value.slice(0, 4)}${"•".repeat(Math.min(value.length - 8, 20))}${value.slice(-4)}`;
      } else if (typeof value === "string") {
        masked[key] = value ? "••••" : "";
      }
    }

    return NextResponse.json({ credentials: creds, masked });
  } catch (err: any) {
    const status = err.message === "UNAUTHORIZED" ? 401 : err.message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json({ error: err.message }, { status });
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const session = await requireRole([Role.ADMIN]);
    const body = await req.json();

    const existing = await db.appSetting.findUnique({ where: { key: CREDENTIAL_KEY } });
    const current = existing ? { ...DEFAULTS, ...(existing.value as Partial<IntegrationCredentials>) } : DEFAULTS;

    // Only update fields that are provided (non-empty strings or any boolean)
    const updates: Record<string, string | boolean> = {};
    for (const key of Object.keys(DEFAULTS)) {
      if (key in body) {
        const val = body[key];
        if (typeof val === "boolean") {
          updates[key] = val;
        } else if (typeof val === "string") {
          // If value is masked (contains bullet chars), keep existing value
          if (val.includes("\u2022")) {
            updates[key] = current[key as keyof IntegrationCredentials] as string;
          } else {
            updates[key] = val;
          }
        }
      }
    }

    const merged = { ...current, ...updates };

    await db.appSetting.upsert({
      where: { key: CREDENTIAL_KEY },
      create: { key: CREDENTIAL_KEY, value: merged as any },
      update: { value: merged as any },
    });

    await db.auditLog.create({
      data: {
        userId: session.user.id,
        action: "INTEGRATION_CREDENTIALS_UPDATE",
        entity: "AppSetting",
        entityId: CREDENTIAL_KEY,
        before: current as any,
        after: merged as any,
        ipAddress: req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || req.headers.get("x-real-ip") || null,
      },
    });

    return NextResponse.json({ ok: true });
  } catch (err: any) {
    const status = err.message === "UNAUTHORIZED" ? 401 : err.message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json({ error: err.message }, { status });
  }
}
