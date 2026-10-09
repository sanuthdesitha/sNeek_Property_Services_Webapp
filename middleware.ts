import { canUseOpsPath, opsRequestFeature, type OpsLevels } from "@/lib/rbac/ops-catalog";
import { withAuth } from "next-auth/middleware";
import type { NextRequestWithAuth } from "next-auth/middleware";
import { NextRequest, NextResponse, type NextFetchEvent } from "next/server";
import { readAccountPath, bindAccountUrl, ACCOUNT_PATH_PREFIX } from "@/lib/auth/account-request-scope";
import { Role } from "@prisma/client";
import {
  IMPERSONATION_COOKIE,
  isReadOnlySafeMethod,
  readImpersonationTicket,
} from "@/lib/auth/impersonation";
import {
  PORTAL_VERSION_COOKIE,
  PORTAL_VERSION_COOKIE_MAX_AGE,
  effectivePortalVersion,
  parsePortalVersion,
  portalRootIn,
  type PortalVersion,
} from "@/lib/portal-version";

async function portalMiddleware(req: NextRequestWithAuth & { retainedValidation?: Awaited<ReturnType<typeof validateActiveSession>> }) {
    const { pathname } = req.nextUrl;
    const token = req.nextauth.token;

    // Admin "test as". The ticket is signed with NEXTAUTH_SECRET, so a client
    // cannot mint or edit one; full authority (is the actor still an admin?)
    // is re-checked server-side in impersonation-server.ts. Here it is used
    // only for routing and for the read-only guard, both of which fail safe.
    const impersonation = await readImpersonationTicket(
      req.cookies.get(IMPERSONATION_COOKIE)?.value,
    );

    // READ-ONLY enforcement lives here, at the single choke point every request
    // passes through, rather than in each of the hundreds of route handlers —
    // one missed handler would be a write into production data attributed to
    // the impersonated user. The endpoints that START and STOP impersonation
    // are exempt, or you could never get back out.
    if (
      impersonation &&
      impersonation.mode === "READ_ONLY" &&
      !isReadOnlySafeMethod(req.method) &&
      !pathname.startsWith("/api/admin/impersonate")
    ) {
      return applySecurityHeaders(
        NextResponse.json(
          {
            error:
              "Read-only test session: writes are blocked while viewing as another user. Switch to full test mode to change data.",
            code: "IMPERSONATION_READ_ONLY",
          },
          { status: 403 },
        ),
      );
    }

    if (pathname.startsWith("/api")) {
      // API authorization must also cover legacy handlers and their status codes.
      // The session-validation endpoints are unclassified, preventing recursion.
      if (token && opsRequestFeature(pathname + req.nextUrl.search) !== null && !pathname.startsWith("/api/admin/impersonate")) {
        const validation = req.retainedValidation ?? await validateActiveSession(req);
        if (validation.valid !== true) return applySecurityHeaders(NextResponse.json({ error: validation.valid === false ? "UNAUTHORIZED" : "Permissions are temporarily unavailable." }, { status: validation.valid === false ? 401 : 503 }));
        if (validation.opsAccess && !canUseOpsPath(validation.opsAccess, pathname + req.nextUrl.search, req.method)) {
          return applySecurityHeaders(NextResponse.json({ error: "This feature or action is disabled in your operations-manager permissions.", code: "OPS_FEATURE_FORBIDDEN" }, { status: 403 }));
        }
      }
      return applySecurityHeaders(NextResponse.next());
    }

    // ── Look switching (v1 classic ↔ v2 Estate) ──────────────────────────
    // `?look=v2` on any URL records a personal preference and drops the param.
    // Handled here rather than in a client handler so the switch links are
    // plain anchors that work without JavaScript, and so the redirect happens
    // before any page renders in the wrong skin.
    const requestedLook = parsePortalVersion(req.nextUrl.searchParams.get("look"));
    if (requestedLook) {
      const clean = req.nextUrl.clone();
      clean.searchParams.delete("look");
      const res = applySecurityHeaders(NextResponse.redirect(clean));
      res.cookies.set(PORTAL_VERSION_COOKIE, requestedLook, {
        httpOnly: false, // read by the switcher UI to show the current look
        sameSite: "lax",
        secure: process.env.NODE_ENV === "production",
        path: "/",
        maxAge: PORTAL_VERSION_COOKIE_MAX_AGE,
      });
      return res;
    }
    const lookOverride = parsePortalVersion(req.cookies.get(PORTAL_VERSION_COOKIE)?.value);

    let role = token?.role as Role | undefined;
    // Every role this person may act as. `role` above stays the ACTIVE one and
    // decides where they LAND; this list decides where they are ALLOWED. A
    // cleaner who also inspects must be able to open /v2/qa without first
    // flicking a switch they cannot reach from outside the portal.
    let heldRoles: Role[] | undefined;
    let houseLook: PortalVersion | undefined;
    if (token) {
      const validation = req.retainedValidation ?? await validateActiveSession(req);
      if (validation.valid === false) {
        return applySecurityHeaders(NextResponse.redirect(new URL("/api/auth/local-signout", req.url)));
      }
      role = validation.role ?? role;
      heldRoles = validation.heldRoles ?? (role ? [role] : undefined);
      houseLook = validation.defaultPortalVersion;
      if (validation.valid === "indeterminate" && role === Role.OPS_MANAGER) {
        return applySecurityHeaders(new NextResponse("Permissions are temporarily unavailable. Please retry.", { status: 503 }));
      }
      if (validation.opsAccess && !canUseOpsPath(validation.opsAccess, pathname + req.nextUrl.search, req.method)) {
        return applySecurityHeaders(NextResponse.redirect(new URL("/v2/admin/access-denied", req.url)));
      }

      const isForcePasswordPage = pathname === "/force-password-reset";
      // v2-context users get the Estate onboarding; v1 keeps the classic one.
      const inV2 = pathname.startsWith("/v2");
      const onboardingPath = inV2 ? "/v2/onboarding" : "/onboarding";
      const isOnboardingPage = pathname === "/onboarding" || pathname === "/v2/onboarding";
      if (validation.valid !== "indeterminate" && validation.requiresPasswordReset && !isForcePasswordPage) {
        return applySecurityHeaders(NextResponse.redirect(new URL("/force-password-reset", req.url)));
      }
      if (validation.valid !== "indeterminate" && !validation.requiresPasswordReset && isForcePasswordPage) {
        return applySecurityHeaders(NextResponse.redirect(new URL(portalHome(role), req.url)));
      }

      if (validation.valid !== "indeterminate" && !validation.requiresPasswordReset) {
        if (validation.requiresOnboarding && !isOnboardingPage) {
          return applySecurityHeaders(NextResponse.redirect(new URL(onboardingPath, req.url)));
        }
        if (!validation.requiresOnboarding && isOnboardingPage) {
          return applySecurityHeaders(NextResponse.redirect(new URL(inV2 ? v2PortalHome(role) : portalHome(role), req.url)));
        }
      }
    }

    // The look this request should be served in: a personal override beats the
    // house default, so one person can work in the other version without
    // anyone else being affected.
    const look = effectivePortalVersion(houseLook, lookOverride);
    const homeForLook = (r: Role | undefined) => (look === "v2" ? v2PortalHome(r) : portalHome(r));

    // Redirect logged-in users away from auth pages, into the current look.
    if ((pathname === "/login" || pathname === "/register") && token) {
      return applySecurityHeaders(NextResponse.redirect(new URL(homeForLook(role), req.url)));
    }

    // Signing IN is an entry point too, so it follows the current look: on v2
    // the Estate login is the front door and nobody should meet the classic one
    // on the way in. A personal v1 override still lands on the v1 page, which is
    // what keeps "switch back to classic" honest. No loop is possible — the
    // /v2/login branch below renders rather than redirecting when signed out.
    if (pathname === "/login" && !token && look === "v2") {
      const login = new URL("/v2/login", req.url);
      const callbackUrl = req.nextUrl.searchParams.get("callbackUrl");
      if (callbackUrl) login.searchParams.set("callbackUrl", callbackUrl);
      return applySecurityHeaders(NextResponse.redirect(login));
    }

    // A portal ROOT opened in the other version follows the current look. Only
    // roots are rewritten — deep links stay exactly where they point, so a
    // bookmark or an emailed link never breaks because of a global switch, and
    // portalRootIn() returns null when the path is already correct, which is
    // what makes this incapable of looping.
    if (token) {
      const target = portalRootIn(pathname, look);
      if (target) {
        return applySecurityHeaders(NextResponse.redirect(new URL(target, req.url)));
      }
    }

    // v2 (Estate) portals. /v2 has its own Estate-themed login at /v2/login —
    // same NextAuth credentials/2FA as v1 (shared session cookie), it only
    // changes where the user lands afterwards. v1 logins/redirects untouched;
    // v2 public pages stay unrouted pre-cutover.
    if (pathname === "/v2/login") {
      // Already signed in → straight to the role's home in the current look.
      if (token) {
        return applySecurityHeaders(NextResponse.redirect(new URL(homeForLook(role), req.url)));
      }
      return applySecurityHeaders(NextResponse.next());
    }
    if (pathname.startsWith("/v2")) {
      // Unauthenticated v2 traffic goes to the v2 login (not the v1 one).
      if (!token) {
        const login = new URL("/v2/login", req.url);
        login.searchParams.set("callbackUrl", pathname);
        return applySecurityHeaders(NextResponse.redirect(login));
      }
      // /v2 root → the signed-in role's portal home.
      if (pathname === "/v2" || pathname === "/v2/") {
        return applySecurityHeaders(NextResponse.redirect(new URL(v2PortalHome(role), req.url)));
      }
      // Shared v2 pages any signed-in role may reach (onboarding wizard).
      if (pathname === "/v2/onboarding") {
        return applySecurityHeaders(NextResponse.next());
      }
      // Asked of every role they HOLD, not just the active one — the same
      // "may I?" / "where am I?" split the session layer makes.
      const has = (target: Role) => (heldRoles ?? (role ? [role] : [])).includes(target);
      const isAdminOps = has(Role.ADMIN) || has(Role.OPS_MANAGER);
      if (!isAdminOps) {
        const ownsPortal =
          // V1 — a VA works inside the client portal on their client's behalf.
          // Middleware only decides WHICH portal they may enter; what they may
          // do once inside is requireClientPortal()'s job
          // (lib/auth/client-portal.ts), which is the only place that reads the
          // team's permissions and property scope.
          (pathname.startsWith("/v2/client") && (has(Role.CLIENT) || has(Role.VA))) ||
          (pathname.startsWith("/v2/cleaner") && has(Role.CLEANER)) ||
          (pathname.startsWith("/v2/laundry") && has(Role.LAUNDRY)) ||
          (pathname.startsWith("/v2/qa") && has(Role.QA_INSPECTOR)) ||
          (pathname.startsWith("/v2/maintenance") && has(Role.MAINTENANCE));
        if (!ownsPortal) {
          return applySecurityHeaders(NextResponse.redirect(new URL("/unauthorized", req.url)));
        }
      }
    }

    // The v1 gates ask the same "may I?" question as the v2 block above. Kept
    // as its own binding rather than reusing the one scoped inside that block,
    // so a future edit to either cannot silently change the other.
    const holds = (target: Role) => (heldRoles ?? (role ? [role] : [])).includes(target);

    // Admin routes
    if (pathname.startsWith("/admin")) {
      if (!holds(Role.ADMIN) && !holds(Role.OPS_MANAGER)) {
        return applySecurityHeaders(NextResponse.redirect(new URL("/unauthorized", req.url)));
      }
      // Certain admin-only sub-routes
      if (
        (pathname.startsWith("/admin/settings/pricebook") ||
          pathname.startsWith("/admin/settings/pay-rates")) &&
        !holds(Role.ADMIN)
      ) {
        return applySecurityHeaders(NextResponse.redirect(new URL("/unauthorized", req.url)));
      }
    }

    // Cleaner routes
    if (pathname.startsWith("/cleaner") && !holds(Role.CLEANER)) {
      return applySecurityHeaders(NextResponse.redirect(new URL("/unauthorized", req.url)));
    }

    // Client routes — a VA enters the same portal as the client they act for.
    if (pathname.startsWith("/client") && !holds(Role.CLIENT) && !holds(Role.VA)) {
      return applySecurityHeaders(NextResponse.redirect(new URL("/unauthorized", req.url)));
    }

    // Laundry routes
    if (pathname.startsWith("/laundry") && !holds(Role.LAUNDRY)) {
      return applySecurityHeaders(NextResponse.redirect(new URL("/unauthorized", req.url)));
    }

    // Maintenance routes — workers, plus admin/ops for oversight
    if (
      pathname.startsWith("/maintenance") &&
      !holds(Role.MAINTENANCE) &&
      !holds(Role.ADMIN) &&
      !holds(Role.OPS_MANAGER)
    ) {
      return applySecurityHeaders(NextResponse.redirect(new URL("/unauthorized", req.url)));
    }

    return applySecurityHeaders(NextResponse.next());
}
const normalMiddleware = withAuth(portalMiddleware, {
    callbacks: {
      authorized({ token, req }) {
        const { pathname } = req.nextUrl;
        // Let API routes execute and enforce auth inside handlers.
        // This avoids HTML redirect responses for API calls.
        if (pathname.startsWith("/api")) {
          return true;
        }
        // Public routes
        if (
          pathname === "/accounts" ||
          pathname === "/login" ||
          pathname === "/v2/login" ||
          pathname === "/register" ||
          pathname === "/forgot-password" ||
          pathname === "/reset-password" ||
          pathname === "/recover-2fa" ||
          pathname === "/unauthorized" ||
          pathname === "/" ||
          pathname.startsWith("/rate/") ||
          pathname.startsWith("/q/") ||
          pathname === "/services" ||
          pathname.startsWith("/services/") ||
          pathname === "/why-us" ||
          pathname === "/faq" ||
          pathname === "/quote" ||
          pathname === "/contact" ||
          pathname === "/careers" ||
          pathname === "/blog" ||
          pathname.startsWith("/blog/") ||
          pathname === "/compare" ||
          pathname.startsWith("/cleaning/") ||
          pathname === "/subscriptions" ||
          pathname === "/terms" ||
          pathname === "/privacy" ||
          pathname === "/airbnb-hosting" ||
          pathname.startsWith("/apply/") ||
          pathname.startsWith("/quiz/") ||
          pathname.startsWith("/amenities/") ||
          pathname.startsWith("/accept-invite/") ||
          // Public report verification — anyone holding a report code may check it.
          pathname === "/verify" ||
          pathname.startsWith("/verify/") ||
          pathname === "/icon" ||
          pathname === "/manifest.json"
        ) {
          return true;
        }
        // /v2/* must reach the middleware function even without a token so it
        // can redirect to the Estate login (/v2/login) instead of the v1 one.
        if (pathname.startsWith("/v2")) {
          return true;
        }
        return !!token;
      },
    },
  }
);


export default async function middleware(original: NextRequest, event: NextFetchEvent) {
  const headers = new Headers(original.headers);
  headers.delete("x-sneek-retained-context");
  // Overwrite client-supplied metadata before any server authorization reads it.
  const logicalPath = readAccountPath(original.nextUrl.pathname)?.pathname ?? original.nextUrl.pathname;
  headers.set("x-sneek-request-path", logicalPath + original.nextUrl.search);
  headers.set("x-sneek-request-method", original.method);
  // nextUrl may contain the server's bind address (0.0.0.0) behind a proxy.
  // Browser referrers and redirects use the public host, as NextAuth does.
  const publicHost = headers.get("x-forwarded-host")?.split(",")[0]?.trim() || headers.get("host") || original.nextUrl.host;
  const publicProtocol = headers.get("x-forwarded-proto")?.split(",")[0]?.trim() || original.nextUrl.protocol.replace(":", "");
  if (!["http", "https"].includes(publicProtocol)) return NextResponse.json({ error: "Invalid origin" }, { status: 400 });
  const publicOrigin = new URL(`${publicProtocol}://${publicHost}`).origin;
  const path = original.nextUrl.pathname;
  // Worker scripts are public infrastructure. Redirecting registration into a
  // retained account path prevents updates in browsers with scoped tabs open.
  if (/^\/(?:sw\.js|workbox-[\w-]+\.js|worker-[\w-]+\.js)$/.test(path)) {
    return NextResponse.next({ request: { headers } });
  }
  const context = readAccountPath(path);
  if (path.startsWith(ACCOUNT_PATH_PREFIX) && !context) return NextResponse.json({ error: "Invalid account context" }, { status: 400 });
  if (!context) {
    let referringContext = null;
    try { const ref = new URL(headers.get("referer") ?? ""); if (ref.origin === publicOrigin) referringContext = readAccountPath(ref.pathname); } catch { /* absent */ }
    // A missed client transport must fail closed, not silently use the root account.
    if (referringContext && !path.startsWith("/api/auth/retained") && path !== "/accounts" && path !== "/account-context.js") {
      if (path.startsWith("/api/") && ["image", "video", "audio", "iframe"].includes(headers.get("sec-fetch-dest") ?? "") && original.method === "GET") return NextResponse.redirect(new URL(bindAccountUrl(referringContext.contextId, publicOrigin)(path + original.nextUrl.search), publicOrigin));
      if (path.startsWith("/api/")) return NextResponse.json({ error: "Account context required. Reload this tab.", code: "ACCOUNT_CONTEXT_REQUIRED" }, { status: 409 });
      if (original.method === "GET" && !path.startsWith("/_next/")) return NextResponse.redirect(new URL(bindAccountUrl(referringContext.contextId, publicOrigin)(path + original.nextUrl.search), publicOrigin));
    }
    const request = new NextRequest(original, { headers });
    const response = await (normalMiddleware as any)(request, event) as NextResponse;
    if (response?.headers.get("x-middleware-next") === "1") {
      const next = NextResponse.next({ request: { headers } });
      response.headers.forEach((value, key) => { if (!key.startsWith("x-middleware-")) next.headers.set(key, value); });
      return next;
    }
    return response;
  }
  if (context.pathname === "/accounts" || context.pathname === "/login" || context.pathname === "/v2/login" || context.pathname === "/api/auth/local-signout") return NextResponse.redirect(new URL("/accounts", publicOrigin));
  if (context.pathname.startsWith("/api/admin/impersonate") || context.pathname === "/api/me/active-role" && original.method !== "GET" || /^\/api\/auth\/(?:callback|signin)/.test(context.pathname)) return NextResponse.json({ error: "Manage identities from Accounts; this tab cannot change another account's session." }, { status: 403 });
  let validation;
  try {
    const url = sessionValidationUrl("/api/auth/retained/validate", original.url); url.searchParams.set("context", context.contextId);
    const response = await fetch(url, { headers: { cookie: headers.get("cookie") ?? "" }, cache: "no-store", redirect: "error", signal: AbortSignal.timeout(5_000) });
    validation = response.ok ? await response.json() : null;
  } catch { validation = null; }
  if (!validation?.valid) return context.pathname.startsWith("/api/")
    ? NextResponse.json({ error: "This account session expired or was revoked. Reauthenticate from Accounts." }, { status: 401, headers: { "Cache-Control": "no-store" } })
    : NextResponse.redirect(new URL("/accounts?reauth=1", publicOrigin));
  headers.set("x-sneek-retained-context", context.contextId);
  const jar = (headers.get("cookie") ?? "").split(";").map(value => value.trim()).filter(value => {
    const name = value.split("=")[0];
    return !/^(?:__Secure-)?next-auth\.session-token(?:\.|$)/.test(name) && !/^(?:__Secure-)?sneek\.retained-jwt\./.test(name) && !["sneek.test-as", "sneek.active-role"].includes(name);
  });
  // Presence sentinels are transport only. auth-options.decode revalidates the
  // opaque retained cookies against the database; these strings confer no authority.
  for (const name of ["next-auth.session-token", "__Secure-next-auth.session-token", `sneek.retained-jwt.${context.contextId}`, `__Secure-sneek.retained-jwt.${context.contextId}`]) jar.push(`${name}=retained-context`);
  headers.set("cookie", jar.join("; "));
  const url = original.nextUrl.clone(); url.pathname = context.pathname;
  const request = new NextRequest(url, { method: original.method, headers });
  Object.assign(request, { nextauth: { token: { id: validation.id, role: validation.role } }, retainedValidation: validation });
  const result = await portalMiddleware(request as any);
  const location = result.headers.get("location");
  if (location) {
    const destination = new URL(location, original.url);
    const target = ["/login", "/v2/login", "/api/auth/local-signout"].includes(destination.pathname) ? "/accounts?reauth=1" : bindAccountUrl(context.contextId, publicOrigin)(destination.pathname + destination.search + destination.hash);
    result.headers.set("location", new URL(target, publicOrigin).href);
    return result;
  }
  if (result.headers.get("x-middleware-next") !== "1") return result;
  const response = NextResponse.rewrite(url, { request: { headers } });
  result.headers.forEach((value, key) => { if (!key.startsWith("x-middleware-")) response.headers.set(key, value); });
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}

function applySecurityHeaders(response: NextResponse) {
  response.headers.set("X-Frame-Options", "DENY");
  response.headers.set("X-Content-Type-Options", "nosniff");
  response.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  response.headers.set(
    "Content-Security-Policy",
    // script/style/font/worker allowances for the Google Maps JS API
    // (live ops map, route map, address autocomplete).
    // frame-src/object-src allow blob: so the app can preview its own generated
    // PDFs (quote preview, checklist, reports) in an inline iframe — without it
    // they fall back to default-src 'self' and the blob: frame is blocked.
    "default-src 'self'; base-uri 'self'; frame-ancestors 'none'; frame-src 'self' blob:; object-src 'self' blob:; form-action 'self'; img-src 'self' data: blob: https:; font-src 'self' data: https://fonts.gstatic.com; script-src 'self' 'unsafe-inline' 'unsafe-eval' https://maps.googleapis.com https://maps.gstatic.com; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; worker-src 'self' blob:; connect-src 'self' https: wss:;"
  );
  response.headers.set("Permissions-Policy", "camera=(), microphone=(), geolocation=(self)");
  return response;
}

function v2PortalHome(role: Role | undefined): string {
  switch (role) {
    case Role.ADMIN:
    case Role.OPS_MANAGER:
      return "/v2/admin";
    case Role.CLEANER:
      return "/v2/cleaner";
    case Role.CLIENT:
    // A VA lands in the portal of the client they act for — they have no
    // surface of their own.
    case Role.VA:
      return "/v2/client";
    case Role.LAUNDRY:
      return "/v2/laundry";
    case Role.QA_INSPECTOR:
      return "/v2/qa";
    case Role.MAINTENANCE:
      return "/v2/maintenance";
    default:
      // Unresolvable role with a live token: fall back to the public home
      // rather than /v2/login, which would redirect-loop for signed-in users.
      return "/";
  }
}

function portalHome(role: Role | undefined): string {
  switch (role) {
    case Role.ADMIN:
    case Role.OPS_MANAGER:
      return "/admin";
    case Role.CLEANER:
      return "/cleaner";
    case Role.CLIENT:
    case Role.VA:
      return "/client";
    case Role.LAUNDRY:
      return "/laundry";
    case Role.QA_INSPECTOR:
      return "/qa";
    case Role.MAINTENANCE:
      return "/maintenance";
    default:
      return "/login";
  }
}

// Only deployment configuration may select a private callback destination.
// Never use forwarded headers: this request carries session cookies.
function sessionValidationUrl(path: string, requestUrl: string) {
  return new URL(path, process.env.NEXTAUTH_URL_INTERNAL || requestUrl);
}

async function validateActiveSession(req: NextRequestWithAuth) {
  try {
    const response = await fetch(sessionValidationUrl("/api/auth/validate-session", req.url), {
      headers: {
        cookie: req.headers.get("cookie") ?? "",
      },
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(5_000),
    });

    // A backend outage is not an expired account. Keep API/OPS access closed
    // without redirecting a valid owner into a sign-out loop.
    if (!response.ok && response.status !== 401 && response.status !== 403) {
      throw new Error("Session validation service unavailable");
    }
    if (!response.ok) {
      return { valid: false as const, role: undefined, heldRoles: undefined, opsAccess: null };
    }

    const data = (await response.json()) as {
      valid: boolean;
      role?: Role;
      heldRoles?: Role[];
      requiresPasswordReset?: boolean;
      requiresOnboarding?: boolean;
      defaultPortalVersion?: PortalVersion;
      opsAccess?: OpsLevels | null;
    };
    return {
      valid: data.valid === true,
      opsAccess: data.opsAccess ?? null,
      role: data.role as Role | undefined,
      heldRoles: Array.isArray(data.heldRoles) ? (data.heldRoles as Role[]) : undefined,
      requiresPasswordReset: data.requiresPasswordReset === true,
      requiresOnboarding: data.requiresOnboarding === true,
      // The house look rides along on this call — middleware is edge and
      // cannot read the settings row itself.
      defaultPortalVersion: parsePortalVersion(data.defaultPortalVersion) ?? undefined,
    };
  } catch {
    return {
      valid: "indeterminate" as const,
      opsAccess: null,
      role: req.nextauth.token?.role as Role | undefined,
      // No extra roles known on a failed call. Falling back to the token's
      // single role is the safe direction: it can only ever grant LESS than the
      // person actually holds, so a blip locks somebody out of a second portal
      // for a moment rather than letting anyone into one they do not own.
      heldRoles: undefined,
      requiresPasswordReset: false,
      requiresOnboarding: false,
      // Unknown → the caller falls back to the classic app rather than
      // guessing, so a blip in this call can never bounce people around.
      defaultPortalVersion: undefined,
    };
  }
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|icon|manifest.json|images|fonts).*)",
  ],
};
