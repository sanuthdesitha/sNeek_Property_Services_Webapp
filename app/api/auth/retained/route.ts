import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireRealSession } from "@/lib/auth/session";
import { completeRetainedEnrollment, prepareRetainedIdentity, listRetainedAccounts, listRetainedAccountsForBrowser, revokeRetainedAccount } from "@/lib/auth/retained-accounts";
import { RETAINED_BROWSER_COOKIE, retainedSecretCookie } from "@/lib/auth/retained-context";
const proofCookie = (slot: string) => `${process.env.NODE_ENV === "production" ? "__Host-" : ""}sneek.retained-proof.${slot}`;
const options = { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "strict" as const, path: "/", maxAge: 8 * 60 * 60 };
const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { "Cache-Control": "private, no-store" } });
const credentials = z.object({ email: z.string().email().max(320), password: z.string().min(1).max(1024) });
export async function GET(req: NextRequest) {
  try {
    const session = await requireRealSession().catch(() => null);
    const browserSecret = req.cookies.get(RETAINED_BROWSER_COOKIE)?.value ?? "";
    const accounts = session ? await listRetainedAccounts(browserSecret, session.user.id)
      : await listRetainedAccountsForBrowser(browserSecret, id => req.cookies.get(retainedSecretCookie(id))?.value ?? "");
    return json({ accounts, currentEmail: session?.user.email ?? null, canEnroll: Boolean(session) });
  } catch { return json({ error: "Sign in to manage retained accounts." }, 401); }
}
export async function POST(req: NextRequest) {
  // Enrollment/revocation are explicit same-origin human actions, never a GET.
  const forwardedHost = req.headers.get("x-forwarded-host")?.split(",")[0]?.trim();
  const forwardedProto = req.headers.get("x-forwarded-proto")?.split(",")[0]?.trim();
  const origin = forwardedHost && ["http", "https"].includes(forwardedProto ?? "") ? `${forwardedProto}://${forwardedHost}` : req.nextUrl.origin;
  if (req.headers.get("origin") !== origin) return json({ error: "Same-origin confirmation required." }, 403);
  try {
    const session = await requireRealSession();
    if (!["ADMIN", "CLEANER"].includes(session.user.role) || req.cookies.get("sneek.test-as")) return json({ error: "Use your own Admin or Cleaner account." }, 403);
    const body = await req.json();
    if (body.action === "prepare") {
      const input = z.object({ slot: z.enum(["owner", "other"]), credentials }).parse(body);
      const ticket = await prepareRetainedIdentity(input.credentials, req.headers.get("cookie") ?? "", session.user.id);
      const response = json({ ok: true });
      response.cookies.set(proofCookie(input.slot), ticket, { ...options, maxAge: 600 });
      return response;
    }
    if (body.action === "link") {
      if (body.consent !== true) return json({ error: "Confirm that both accounts are yours before linking." }, 400);
      const existing = await listRetainedAccounts(req.cookies.get(RETAINED_BROWSER_COOKIE)?.value ?? "", session.user.id);
      if (existing.some(account => account.available)) return json({ error: "Remove the existing retained accounts before linking again. Other tabs keep their own context until revoked." }, 409);
      const linked = await completeRetainedEnrollment(req.cookies.get(proofCookie("owner"))?.value ?? "", req.cookies.get(proofCookie("other"))?.value ?? "", session.user.id, true);
      const response = json({ ok: true });
      for (const cookie of req.cookies.getAll()) if (/^(?:__Host-)?sneek\.retained-secret\./.test(cookie.name)) response.cookies.set(cookie.name, "", { ...options, maxAge: 0 });
      response.cookies.set(RETAINED_BROWSER_COOKIE, linked.browserSecret, options);
      for (const member of linked.accounts) response.cookies.set(retainedSecretCookie(member.contextId), member.contextSecret, options);
      for (const slot of ["owner", "other"]) response.cookies.set(proofCookie(slot), "", { ...options, maxAge: 0 });
      return response;
    }
    if (body.action === "revoke") {
      const contextId = z.string().regex(/^[a-f0-9]{32}$/).parse(body.contextId);
      const browserSecret = req.cookies.get(RETAINED_BROWSER_COOKIE)?.value ?? "";
      const own = await listRetainedAccounts(browserSecret, session.user.id);
      if (!own.some(account => account.contextId === contextId)) return json({ error: "Account unavailable." }, 403);
      await revokeRetainedAccount({ contextId, browserSecret, contextSecret: req.cookies.get(retainedSecretCookie(contextId))?.value ?? "" }, body.all === true);
      const response = json({ ok: true });
      for (const account of own.filter(account => body.all === true || account.contextId === contextId)) response.cookies.set(retainedSecretCookie(account.contextId), "", { ...options, maxAge: 0 });
      return response;
    }
    return json({ error: "Unknown action." }, 400);
  } catch { return json({ error: "Account verification failed or expired. Authenticate both accounts again, including any required verification code." }, 401); }
}
