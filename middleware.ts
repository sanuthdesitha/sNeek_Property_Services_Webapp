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
          pathname === "/register" ||
          pathname === "/unauthorized" ||
          pathname === "/" ||
          pathname.startsWith("/apply/") ||
          pathname === "/icon" ||
          pathname === "/manifest.json"
        ) {
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
  response.headers.set("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  response.headers.set(
    "Content-Security-Policy",
    "default-src 'self'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'; img-src 'self' data: blob: https:; font-src 'self' data:; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; connect-src 'self' https: wss:;"
  );
  return response;
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
