import { withAuth } from "next-auth/middleware";
import type { NextRequestWithAuth } from "next-auth/middleware";
import { NextResponse } from "next/server";
import { Role } from "@prisma/client";

export default withAuth(
  async function middleware(req) {
    const { pathname } = req.nextUrl;
    const token = req.nextauth.token;

    if (pathname.startsWith("/api")) {
      return applySecurityHeaders(NextResponse.next());
    }

    let role = token?.role as Role | undefined;
    if (token) {
      const validation = await validateActiveSession(req);
      if (validation.valid === false) {
        return applySecurityHeaders(NextResponse.redirect(new URL("/api/auth/local-signout", req.url)));
      }
      role = validation.role ?? role;

      const isForcePasswordPage = pathname === "/force-password-reset";
      const isOnboardingPage = pathname === "/onboarding";
      if (validation.valid !== "indeterminate" && validation.requiresPasswordReset && !isForcePasswordPage) {
        return applySecurityHeaders(NextResponse.redirect(new URL("/force-password-reset", req.url)));
      }
      if (validation.valid !== "indeterminate" && !validation.requiresPasswordReset && isForcePasswordPage) {
        return applySecurityHeaders(NextResponse.redirect(new URL(portalHome(role), req.url)));
      }

      if (validation.valid !== "indeterminate" && !validation.requiresPasswordReset) {
        if (validation.requiresOnboarding && !isOnboardingPage) {
          return applySecurityHeaders(NextResponse.redirect(new URL("/onboarding", req.url)));
        }
        if (!validation.requiresOnboarding && isOnboardingPage) {
          return applySecurityHeaders(NextResponse.redirect(new URL(portalHome(role), req.url)));
        }
      }
    }

    // Redirect logged-in users away from auth pages
    if ((pathname === "/login" || pathname === "/register") && token) {
      return applySecurityHeaders(NextResponse.redirect(new URL(portalHome(role), req.url)));
    }

    // v2 (Estate) portals. /v2 has its own Estate-themed login at /v2/login —
    // same NextAuth credentials/2FA as v1 (shared session cookie), it only
    // changes where the user lands afterwards. v1 logins/redirects untouched;
    // v2 public pages stay unrouted pre-cutover.
    if (pathname === "/v2/login") {
      // Already signed in → straight to the role's v2 portal home.
      if (token) {
        return applySecurityHeaders(NextResponse.redirect(new URL(v2PortalHome(role), req.url)));
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
    "default-src 'self'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'; img-src 'self' data: blob: https:; font-src 'self' data: https://fonts.gstatic.com; script-src 'self' 'unsafe-inline' 'unsafe-eval' https://maps.googleapis.com https://maps.gstatic.com; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; worker-src 'self' blob:; connect-src 'self' https: wss:;"
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
    };
    return {
      valid: data.valid === true,
      role: data.role as Role | undefined,
      requiresPasswordReset: data.requiresPasswordReset === true,
      requiresOnboarding: data.requiresOnboarding === true,
    };
  } catch {
    return {
      valid: "indeterminate" as const,
      role: req.nextauth.token?.role as Role | undefined,
      requiresPasswordReset: false,
      requiresOnboarding: false,
    };
  }
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|icon|manifest.json|images|fonts).*)",
  ],
};
