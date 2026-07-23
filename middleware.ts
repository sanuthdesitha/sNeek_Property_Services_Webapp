import { withAuth } from "next-auth/middleware";
import type { NextRequestWithAuth } from "next-auth/middleware";
import { NextResponse } from "next/server";
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

export default withAuth(
  async function middleware(req) {
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
    let houseLook: PortalVersion | undefined;
    if (token) {
      const validation = await validateActiveSession(req);
      if (validation.valid === false) {
        return applySecurityHeaders(NextResponse.redirect(new URL("/api/auth/local-signout", req.url)));
      }
      role = validation.role ?? role;
      houseLook = validation.defaultPortalVersion;

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
      const isAdminOps = role === Role.ADMIN || role === Role.OPS_MANAGER;
      if (!isAdminOps) {
        const ownsPortal =
          (pathname.startsWith("/v2/client") && role === Role.CLIENT) ||
          (pathname.startsWith("/v2/cleaner") && role === Role.CLEANER) ||
          (pathname.startsWith("/v2/laundry") && role === Role.LAUNDRY) ||
          (pathname.startsWith("/v2/qa") && role === Role.QA_INSPECTOR) ||
          (pathname.startsWith("/v2/maintenance") && role === Role.MAINTENANCE);
        if (!ownsPortal) {
          return applySecurityHeaders(NextResponse.redirect(new URL("/unauthorized", req.url)));
        }
      }
    }

    // Admin routes
    if (pathname.startsWith("/admin")) {
      if (role !== Role.ADMIN && role !== Role.OPS_MANAGER) {
        return applySecurityHeaders(NextResponse.redirect(new URL("/unauthorized", req.url)));
      }
      // Certain admin-only sub-routes
      if (
        (pathname.startsWith("/admin/settings/pricebook") ||
          pathname.startsWith("/admin/settings/pay-rates")) &&
        role !== Role.ADMIN
      ) {
        return applySecurityHeaders(NextResponse.redirect(new URL("/unauthorized", req.url)));
      }
    }

    // Cleaner routes
    if (pathname.startsWith("/cleaner") && role !== Role.CLEANER) {
      return applySecurityHeaders(NextResponse.redirect(new URL("/unauthorized", req.url)));
    }

    // Client routes
    if (pathname.startsWith("/client") && role !== Role.CLIENT) {
      return applySecurityHeaders(NextResponse.redirect(new URL("/unauthorized", req.url)));
    }

    // Laundry routes
    if (pathname.startsWith("/laundry") && role !== Role.LAUNDRY) {
      return applySecurityHeaders(NextResponse.redirect(new URL("/unauthorized", req.url)));
    }

    // Maintenance routes — workers, plus admin/ops for oversight
    if (
      pathname.startsWith("/maintenance") &&
      role !== Role.MAINTENANCE &&
      role !== Role.ADMIN &&
      role !== Role.OPS_MANAGER
    ) {
      return applySecurityHeaders(NextResponse.redirect(new URL("/unauthorized", req.url)));
    }

    return applySecurityHeaders(NextResponse.next());
  },
  {
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

async function validateActiveSession(req: NextRequestWithAuth) {
  try {
    const response = await fetch(new URL("/api/auth/validate-session", req.url), {
      headers: {
        cookie: req.headers.get("cookie") ?? "",
      },
      cache: "no-store",
    });

    if (!response.ok) {
      return { valid: false as const, role: undefined };
    }

    const data = (await response.json()) as {
      valid: boolean;
      role?: Role;
      requiresPasswordReset?: boolean;
      requiresOnboarding?: boolean;
      defaultPortalVersion?: PortalVersion;
    };
    return {
      valid: data.valid === true,
      role: data.role as Role | undefined,
      requiresPasswordReset: data.requiresPasswordReset === true,
      requiresOnboarding: data.requiresOnboarding === true,
      // The house look rides along on this call — middleware is edge and
      // cannot read the settings row itself.
      defaultPortalVersion: parsePortalVersion(data.defaultPortalVersion) ?? undefined,
    };
  } catch {
    return {
      valid: "indeterminate" as const,
      role: req.nextauth.token?.role as Role | undefined,
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
