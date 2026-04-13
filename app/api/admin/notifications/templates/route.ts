import { NextRequest, NextResponse } from "next/server";
import { Role, NotificationChannel } from "@prisma/client";
import { z } from "zod";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { FINANCE_EVENTS, FINANCE_EVENT_CATEGORIES } from "@/lib/notifications/events";
import { getDefaultNotificationTemplates, NOTIFICATION_TEMPLATE_DEFINITIONS } from "@/lib/notification-templates";

export async function GET() {
  try {
    await requireRole([Role.ADMIN, Role.OPS_MANAGER]);

    // Get all DB templates
    const dbTemplates = await db.notificationTemplate.findMany({ orderBy: { eventKey: "asc" } });

    // Get all DB preferences
    const dbPreferences = await db.notificationPreference.findMany({ orderBy: { eventKey: "asc" } });

    // Build default templates from file-based system for any missing in DB
    const defaults = getDefaultNotificationTemplates();
    const definitions = NOTIFICATION_TEMPLATE_DEFINITIONS;

    // Merge: DB templates take priority, fill gaps from defaults
    const templates = FINANCE_EVENTS.map((event) => {
      const dbTpl = dbTemplates.find((t) => t.eventKey === event.key);
      const defaultTpl = defaults[event.key as keyof typeof defaults];
      const def = definitions[event.key as keyof typeof definitions];

      return {
        eventKey: event.key,
        label: event.label,
        category: event.category,
        description: dbTpl?.description ?? null,
        emailSubject: dbTpl?.emailSubject ?? defaultTpl?.webSubject ?? null,
        emailBodyHtml: dbTpl?.emailBodyHtml ?? null,
        emailBodyText: dbTpl?.emailBodyText ?? defaultTpl?.webBody ?? null,
        smsBody: dbTpl?.smsBody ?? defaultTpl?.smsBody ?? null,
        pushTitle: dbTpl?.pushTitle ?? null,
        pushBody: dbTpl?.pushBody ?? null,
        availableVars: event.variables,
        allAvailableVars: Array.from(new Set([...(def?.variables ?? []), ...event.variables])),
        variableLabels: def?.variables ?? event.variables,
        inDb: !!dbTpl,
      };
    });

    // Group preferences by eventKey
    const preferencesByEvent: Record<string, Array<{ channel: string; role: string; enabled: boolean }>> = {};
    for (const pref of dbPreferences) {
      if (!preferencesByEvent[pref.eventKey]) preferencesByEvent[pref.eventKey] = [];
      preferencesByEvent[pref.eventKey].push({
        channel: pref.channel,
        role: pref.recipientRole,
        enabled: pref.enabled,
      });
    }

    return NextResponse.json({ templates, preferencesByEvent });
  } catch (err: any) {
    const status = err.message === "UNAUTHORIZED" ? 401 : err.message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json({ error: err.message ?? "Could not load notification templates." }, { status });
  }
}

const updateTemplateSchema = z.object({
  eventKey: z.string(),
  emailSubject: z.string().nullable().optional(),
  emailBodyHtml: z.string().nullable().optional(),
  emailBodyText: z.string().nullable().optional(),
  smsBody: z.string().nullable().optional(),
  pushTitle: z.string().nullable().optional(),
  pushBody: z.string().nullable().optional(),
});

export async function PATCH(req: NextRequest) {
  try {
    await requireRole([Role.ADMIN]);
    const body = updateTemplateSchema.parse(await req.json());

    const eventDef = FINANCE_EVENTS.find((e) => e.key === body.eventKey);
    if (!eventDef) {
      return NextResponse.json({ error: "Unknown event key" }, { status: 400 });
    }

    const updated = await db.notificationTemplate.upsert({
      where: { eventKey: body.eventKey },
      create: {
        eventKey: body.eventKey,
        label: eventDef.label,
        category: eventDef.category,
        availableVars: eventDef.variables,
        emailSubject: body.emailSubject ?? null,
        emailBodyHtml: body.emailBodyHtml ?? null,
        emailBodyText: body.emailBodyText ?? null,
        smsBody: body.smsBody ?? null,
        pushTitle: body.pushTitle ?? null,
        pushBody: body.pushBody ?? null,
      },
      update: {
        ...(body.emailSubject !== undefined ? { emailSubject: body.emailSubject } : {}),
        ...(body.emailBodyHtml !== undefined ? { emailBodyHtml: body.emailBodyHtml } : {}),
        ...(body.emailBodyText !== undefined ? { emailBodyText: body.emailBodyText } : {}),
        ...(body.smsBody !== undefined ? { smsBody: body.smsBody } : {}),
        ...(body.pushTitle !== undefined ? { pushTitle: body.pushTitle } : {}),
        ...(body.pushBody !== undefined ? { pushBody: body.pushBody } : {}),
      },
    });

    return NextResponse.json(updated);
  } catch (err: any) {
    const status = err.message === "UNAUTHORIZED" ? 401 : err.message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json({ error: err.message ?? "Could not update template." }, { status });
  }
}

const seedSchema = z.object({ force: z.boolean().optional() });

export async function POST(req: NextRequest) {
  try {
    await requireRole([Role.ADMIN]);
    const body = await req.json().catch(() => ({}));
    const { force } = seedSchema.parse(body);

    const defaults = getDefaultNotificationTemplates();
    const existing = await db.notificationTemplate.findMany({ select: { eventKey: true } });
    const existingKeys = new Set(existing.map((t) => t.eventKey));

    let seeded = 0;
    for (const event of FINANCE_EVENTS) {
      if (existingKeys.has(event.key) && !force) continue;
      const def = defaults[event.key as keyof typeof defaults];
      if (!def) continue;

      await db.notificationTemplate.upsert({
        where: { eventKey: event.key },
        create: {
          eventKey: event.key,
          label: event.label,
          category: event.category,
          availableVars: event.variables,
          emailSubject: def.webSubject,
          emailBodyText: def.webBody,
          smsBody: def.smsBody,
          pushTitle: null,
          pushBody: null,
        },
        update: force
          ? {
              emailSubject: def.webSubject,
              emailBodyText: def.webBody,
              smsBody: def.smsBody,
            }
          : {},
      });
      seeded++;
    }

    // Also seed preferences with defaults (all enabled)
    const channels: NotificationChannel[] = ["EMAIL", "PUSH", "SMS"];
    const roles = ["ADMIN", "CLEANER", "CLIENT"] as const;
    for (const event of FINANCE_EVENTS) {
      for (const role of roles) {
        for (const channel of channels) {
          await db.notificationPreference.upsert({
            where: { eventKey_recipientRole_channel: { eventKey: event.key, recipientRole: role, channel } },
            create: { eventKey: event.key, recipientRole: role, channel, enabled: true },
            update: {},
          });
        }
      }
    }

    return NextResponse.json({ ok: true, seeded });
  } catch (err: any) {
    const status = err.message === "UNAUTHORIZED" ? 401 : err.message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json({ error: err.message ?? "Could not seed templates." }, { status });
  }
}
