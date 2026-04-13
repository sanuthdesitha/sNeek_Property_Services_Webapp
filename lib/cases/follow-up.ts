import { Role, type Prisma } from "@prisma/client";
import { formatDistanceStrict } from "date-fns";
import { resolveAppUrl } from "@/lib/app-url";
import { isCaseOpenStatus } from "@/lib/cases/status";
import { db } from "@/lib/db";
import { deliverNotificationToRecipients } from "@/lib/notifications/delivery";

const FOLLOW_UP_THRESHOLD_MS = 48 * 60 * 60 * 1000;
const REPEAT_ALERT_WINDOW_MS = 24 * 60 * 60 * 1000;
const METADATA_KEY = "staleFollowUpAlertedAt";

function readMetadata(value: Prisma.JsonValue | null) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? ({ ...(value as Record<string, unknown>) } as Record<string, unknown>)
    : {};
}

function readAlertedAt(value: unknown) {
  if (typeof value !== "string" || !value.trim()) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export async function sendStaleCaseFollowUps(now = new Date()) {
  const threshold = new Date(now.getTime() - FOLLOW_UP_THRESHOLD_MS);
  const repeatCutoff = new Date(now.getTime() - REPEAT_ALERT_WINDOW_MS);

  const [cases, recipients] = await Promise.all([
    db.issueTicket.findMany({
      where: {
        updatedAt: { lte: threshold },
      },
      select: {
        id: true,
        title: true,
        caseType: true,
        status: true,
        updatedAt: true,
        createdAt: true,
        jobId: true,
        metadata: true,
        job: {
          select: {
            jobNumber: true,
          },
        },
        property: {
          select: {
            name: true,
          },
        },
      },
      orderBy: [{ updatedAt: "asc" }, { createdAt: "asc" }],
      take: 100,
    }),
    db.user.findMany({
      where: {
        role: { in: [Role.ADMIN, Role.OPS_MANAGER] },
        isActive: true,
      },
      select: {
        id: true,
        role: true,
        email: true,
        phone: true,
        name: true,
      },
    }),
  ]);

  if (cases.length === 0 || recipients.length === 0) {
    return { alertedCases: 0, recipients: recipients.length, skipped: cases.length === 0 ? "no_cases" : "no_recipients" };
  }

  const staleCases = cases.filter((item) => {
    if (!isCaseOpenStatus(item.status)) return false;
    const metadata = readMetadata(item.metadata);
    const lastAlertedAt = readAlertedAt(metadata[METADATA_KEY]);
    return !lastAlertedAt || lastAlertedAt <= repeatCutoff;
  });

  if (staleCases.length === 0) {
    return { alertedCases: 0, recipients: recipients.length, skipped: "cooldown" };
  }

  const summaryLines = staleCases.map((item) => {
    const age = formatDistanceStrict(item.updatedAt ?? item.createdAt, now);
    const jobLabel = item.job?.jobNumber?.trim() ? `Job ${item.job.jobNumber}` : "No linked job";
    const propertyLabel = item.property?.name?.trim() || "General case";
    return {
      id: item.id,
      line: `${item.title} (${item.caseType.replace(/_/g, " ")}) - ${propertyLabel} - ${jobLabel} - stale for ${age}`,
    };
  });

  const subject =
    staleCases.length === 1
      ? "1 case needs follow-up"
      : `${staleCases.length} cases need follow-up`;

  const html = `
    <h2 style="margin:0 0 12px;">Cases needing follow-up</h2>
    <p>The following cases have been open without an update for more than 48 hours.</p>
    <ul style="margin:16px 0;padding-left:20px;line-height:1.7;">
      ${summaryLines.map((item) => `<li>${item.line}</li>`).join("")}
    </ul>
    <p><a href="${resolveAppUrl("/admin/cases")}" style="color:#0f766e;font-weight:600;">Open cases board</a></p>
  `.trim();

  await deliverNotificationToRecipients({
    recipients,
    category: "cases",
    web: {
      subject,
      body: summaryLines.length === 1 ? summaryLines[0].line : `${summaryLines.length} cases have been open for more than 48 hours.`,
    },
    email: {
      subject: `sNeek follow-up: ${subject}`,
      html,
      logBody: summaryLines.slice(0, 3).map((item) => item.line).join(" | "),
    },
  });

  await Promise.all(
    staleCases.map((item) => {
      const metadata = readMetadata(item.metadata);
      metadata[METADATA_KEY] = now.toISOString();
      return db.issueTicket.update({
        where: { id: item.id },
        data: {
          metadata: metadata as Prisma.InputJsonValue,
        },
      });
    })
  );

  return {
    alertedCases: staleCases.length,
    recipients: recipients.length,
    skipped: null,
  };
}
