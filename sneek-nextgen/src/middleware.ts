import { NextRequest, NextResponse } from "next/server";
import { getToken } from "next-auth/jwt";

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

export default async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // Allow public routes
  if (
    PUBLIC_ROUTES.some((route) => pathname.startsWith(route)) ||
    MARKETING_ROUTES.some((route) => pathname === route || pathname.startsWith(route + "/"))
  ) {
    return NextResponse.next();
  }

  // Read JWT token directly (edge-safe, no Prisma needed)
  const token = await getToken({
    req,
    secret: process.env.NEXTAUTH_SECRET,
  });

  // Require authentication for portal and API routes
  if (!token?.id) {
    const loginUrl = new URL("/login", req.nextUrl.origin);
    loginUrl.searchParams.set("callbackUrl", pathname);
    return NextResponse.redirect(loginUrl);
  }

  const userRole = token.role as string;

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
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|public/).*)",
  ],
};
