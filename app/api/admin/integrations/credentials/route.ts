import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";

const CREDENTIAL_KEY = "integrationCredentials";

/**
 * Credentials that are secrets. Changing (or clearing) any of these requires the
 * admin to re-enter their account password, and they are redacted from audit
 * logs. The truly system-critical values (DATABASE_URL, auth secret) are NOT
 * editable here at all — they live in the environment and are shown read-only.
 */
const SENSITIVE_KEYS = new Set([
  "resendApiKey",
  "twilioAuthToken",
  "cellcastAppKey",
  "awsSecretAccessKey",
  "stripeSecretKey",
  "stripeWebhookSecret",
  "squareAccessToken",
  "paypalClientSecret",
  "xeroClientSecret",
  "googleMapsApiKey",
  "bootstrapAdminPassword",
  "vapidPrivateKey",
]);

function redactSensitive(obj: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    out[k] = SENSITIVE_KEYS.has(k) ? (v ? "•••set•••" : "") : v;
  }
  return out;
}

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

  // Web Push (VAPID)
  vapidPublicKey: "",
  vapidPrivateKey: "",
  vapidSubject: "",

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

    // SECURITY: never return unmasked secrets to the browser. The PATCH handler
    // treats masked (bullet-containing) values as "unchanged", so the editor can
    // round-trip on masked values without ever seeing the real keys.
    //
    // `locked` reports presence (only) of the system-critical secrets that live
    // in the environment and are never editable from the UI.
    return NextResponse.json({
      masked,
      locked: {
        databaseUrl: !!process.env.DATABASE_URL,
        nextAuthSecret: !!(process.env.NEXTAUTH_SECRET || process.env.AUTH_SECRET),
      },
    });
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

    // Password gate: any actual change to a sensitive credential (including
    // clearing/deleting one) requires the admin to re-enter their account
    // password. This is what stops someone walking up to an unlocked session and
    // wiping the Stripe key, Xero secret, etc.
    const sensitiveChanged = Object.keys(updates).some(
      (k) => SENSITIVE_KEYS.has(k) && updates[k] !== current[k as keyof IntegrationCredentials],
    );
    if (sensitiveChanged) {
      const password = typeof body._password === "string" ? body._password : "";
      const user = await db.user.findUnique({
        where: { id: session.user.id },
        select: { passwordHash: true },
      });
      if (!user?.passwordHash) {
        return NextResponse.json(
          { error: "Set an account password before editing sensitive credentials.", needsPassword: true },
          { status: 403 },
        );
      }
      const ok = !!password && (await bcrypt.compare(password, user.passwordHash));
      if (!ok) {
        return NextResponse.json(
          { error: "Incorrect password — sensitive credentials were not changed.", needsPassword: true },
          { status: 403 },
        );
      }
    }

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
        before: redactSensitive(current) as any,
        after: redactSensitive(merged) as any,
        ipAddress: req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || req.headers.get("x-real-ip") || null,
      },
    });

    return NextResponse.json({ ok: true });
  } catch (err: any) {
    const status = err.message === "UNAUTHORIZED" ? 401 : err.message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json({ error: err.message }, { status });
  }
}
