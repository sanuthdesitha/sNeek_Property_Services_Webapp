import { NextRequest, NextResponse } from "next/server";
import { applyMarketingUnsubscribe, verifyUnsubscribeToken } from "@/lib/email-design/unsubscribe";
import { getAppSettings } from "@/lib/settings";

/**
 * Campaign unsubscribe (public, signed link; owner default 2026-11-16).
 * GET shows a confirmation page with one button (so a mail scanner opening
 * the link does not unsubscribe anyone). POST records the opt-out: the
 * page's button, or a mail app's one-click request (RFC 8058,
 * "List-Unsubscribe=One-Click"). It stops campaign emails only; job,
 * invoice, account and security email continue.
 */
export const dynamic = "force-dynamic";

const HEADERS = { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "X-Robots-Tag": "noindex" };

function escape(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function page(title: string, body: string, status = 200): NextResponse {
  const html = `<!doctype html><html lang="en-AU"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escape(title)}</title><style>body{margin:0;background:#F5F1E8;color:#17221D;font:16px/1.6 -apple-system,'Segoe UI',Arial,sans-serif}main{max-width:520px;margin:40px auto;padding:28px 24px;background:#fff;border:1px solid #E4DED2;border-radius:10px}h1{font:500 26px/1.25 Georgia,serif;margin:0 0 12px}button{min-height:44px;padding:0 20px;border:0;border-radius:8px;background:#1E4A38;color:#FFFDF7;font:600 15px -apple-system,'Segoe UI',Arial,sans-serif;cursor:pointer}button:focus-visible{outline:3px solid #8CC5A6;outline-offset:2px}p.small{color:#5B6660;font-size:14px}@media (prefers-color-scheme:dark){body{background:#0F1512;color:#EEEAE0}main{background:#18201C;border-color:#2C3631}button{background:#8CC5A6;color:#0D1F16}p.small{color:#A7AEA9}}</style></head><body><main>${body}</main></body></html>`;
  return new NextResponse(html, { status, headers: HEADERS });
}

function invalid(): NextResponse {
  return page("Link not recognised", "<h1>This link is not recognised</h1><p>It may be incomplete. Reply to any of our campaign emails with “unsubscribe” and the office will remove you.</p>", 400);
}

function tokenFrom(request: NextRequest): string {
  return request.nextUrl.searchParams.get("t") ?? "";
}

export async function GET(request: NextRequest) {
  const token = tokenFrom(request);
  const email = verifyUnsubscribeToken(token);
  if (!email) return invalid();
  const company = (await getAppSettings().catch(() => null))?.companyName || "sNeek Property Services";
  return page(
    "Unsubscribe from campaign emails",
    `<h1>Unsubscribe from campaign emails?</h1><p>${escape(email)} will stop getting news and offers from ${escape(company)}.</p><form method="post" action="?t=${encodeURIComponent(token)}"><button type="submit">Unsubscribe</button></form><p class="small">Emails about your jobs, invoices, quotes and account still arrive; they are not campaigns.</p>`,
  );
}

export async function POST(request: NextRequest) {
  const token = tokenFrom(request);
  const result = await applyMarketingUnsubscribe(token, request.headers.get("content-type")?.includes("form") && (await request.clone().text()).includes("List-Unsubscribe=One-Click") ? "one-click" : "link");
  if (!result.ok || !result.email) return invalid();
  return page("Unsubscribed", `<h1>You're unsubscribed</h1><p>${escape(result.email)} won't get campaign emails from us any more.</p><p class="small">Emails about your jobs, invoices, quotes and account still arrive.</p>`);
}
