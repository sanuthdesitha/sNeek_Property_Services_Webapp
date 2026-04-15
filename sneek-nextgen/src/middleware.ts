import { auth } from "@/lib/auth";
import { NextResponse } from "next/server";

const ROLE_PORTAL_MAP: Record<string, string> = {
  ADMIN: "/admin",
  OPS_MANAGER: "/admin",
  CLEANER: "/cleaner",
  CLIENT: "/client",
  LAUNDRY: "/laundry",
};

const PUBLIC_ROUTES = [
  "/login",
  "/register",
  "/onboarding",
  "/force-password-reset",
  "/unauthorized",
  "/feedback",
  "/rate",
  "/api/auth",
];

const MARKETING_ROUTES = [
  "/",
  "/services",
  "/cleaning",
  "/quote",
  "/why-us",
  "/faq",
  "/contact",
  "/careers",
  "/blog",
  "/compare",
  "/subscriptions",
  "/airbnb-hosting",
  "/apply",
  "/terms",
  "/privacy",
];

export default auth((req) => {
  const { pathname } = req.nextUrl;

  // Allow public routes
  if (
    PUBLIC_ROUTES.some((route) => pathname.startsWith(route)) ||
    MARKETING_ROUTES.some((route) => pathname === route || pathname.startsWith(route + "/"))
  ) {
    return NextResponse.next();
  }

  // Require authentication for portal and API routes
  if (!req.auth?.user) {
    const loginUrl = new URL("/login", req.nextUrl.origin);
    loginUrl.searchParams.set("callbackUrl", pathname);
    return NextResponse.redirect(loginUrl);
  }

  const userRole = (req.auth.user as { role: string }).role;

  // Portal route guards
  if (pathname.startsWith("/admin")) {
    if (userRole !== "ADMIN" && userRole !== "OPS_MANAGER") {
      return NextResponse.redirect(new URL("/unauthorized", req.nextUrl.origin));
    }
  }

  if (pathname.startsWith("/cleaner")) {
    if (userRole !== "CLEANER") {
      return NextResponse.redirect(new URL("/unauthorized", req.nextUrl.origin));
    }
  }

  if (pathname.startsWith("/client")) {
    if (userRole !== "CLIENT") {
      return NextResponse.redirect(new URL("/unauthorized", req.nextUrl.origin));
    }
  }

  if (pathname.startsWith("/laundry")) {
    if (userRole !== "LAUNDRY") {
      return NextResponse.redirect(new URL("/unauthorized", req.nextUrl.origin));
    }
  }

  // Redirect users to their appropriate portal if they hit root while logged in
  if (pathname === "/") {
    const portalPath = ROLE_PORTAL_MAP[userRole];
    if (portalPath) {
      return NextResponse.redirect(new URL(portalPath, req.nextUrl.origin));
    }
  }

  return NextResponse.next();
});

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|public/).*)",
  ],
};
