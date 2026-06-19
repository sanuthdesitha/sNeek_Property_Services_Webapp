import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { recordHiringReply } from "@/lib/workforce/service";

export const runtime = "nodejs";

/**
 * Inbound-email webhook for capturing candidate REPLIES.
 *
 * Point your inbound-email provider (Resend Inbound, a forwarding service, etc.)
 * at this URL and set INBOUND_EMAIL_SECRET — the provider must send it as the
 * `x-inbound-secret` header or `?secret=` query param. We then match the message
 * to a hiring application and append an EMAIL_REPLY to its timeline.
 *
 * Matching strategy (first hit wins):
 *  1. A reply token in the recipient address local part, e.g. reply+<appId>@…
 *  2. The sender email → most recent application from that address.
 *
 * Provider payloads differ, so we read the common fields defensively.
 */
function pick(obj: any, keys: string[]): string {
  for (const k of keys) {
    const v = obj?.[k];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return "";
}

function extractEmail(value: string): string {
  // "Name <a@b.com>" → a@b.com; otherwise return as-is.
  const m = value.match(/<([^>]+)>/);
  return (m ? m[1] : value).trim().toLowerCase();
}

export async function POST(req: NextRequest) {
  try {
    const expected = process.env.INBOUND_EMAIL_SECRET?.trim();
    if (!expected) {
      // Not configured → refuse rather than accept anonymous posts.
      return NextResponse.json({ error: "Inbound email not configured." }, { status: 503 });
    }
    const provided =
      req.headers.get("x-inbound-secret") ||
      new URL(req.url).searchParams.get("secret") ||
      "";
    if (provided !== expected) {
      return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
    }

    const payload = await req.json().catch(() => ({} as any));
    // Some providers nest the message; flatten common shapes.
    const msg = payload?.data ?? payload?.email ?? payload ?? {};

    const fromRaw = pick(msg, ["from", "sender", "From"]);
    const toRaw = pick(msg, ["to", "recipient", "To"]);
    const subject = pick(msg, ["subject", "Subject"]);
    const body =
      pick(msg, ["text", "plain", "body", "stripped-text"]) ||
      pick(msg, ["html", "Html"]).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();

    const fromEmail = fromRaw ? extractEmail(fromRaw) : "";

    // 1) reply token: reply+<appId>@domain
    let applicationId: string | null = null;
    const tokenMatch = toRaw.match(/\+([a-z0-9]+)@/i);
    if (tokenMatch) {
      const candidate = await db.hiringApplication.findUnique({
        where: { id: tokenMatch[1] },
        select: { id: true },
      });
      if (candidate) applicationId = candidate.id;
    }

    // 2) fall back to the sender email → most recent application
    if (!applicationId && fromEmail) {
      const app = await db.hiringApplication.findFirst({
        where: { email: fromEmail },
        orderBy: { createdAt: "desc" },
        select: { id: true },
      });
      if (app) applicationId = app.id;
    }

    if (!applicationId) {
      // Acknowledge so the provider doesn't retry; nothing to attach to.
      return NextResponse.json({ ok: true, matched: false });
    }

    await recordHiringReply({
      applicationId,
      from: fromEmail || fromRaw || "unknown",
      body: body || subject || "(no content)",
      source: "inbound",
    });

    return NextResponse.json({ ok: true, matched: true });
  } catch (err: any) {
    return NextResponse.json({ error: err.message ?? "Inbound processing failed." }, { status: 400 });
  }
}
