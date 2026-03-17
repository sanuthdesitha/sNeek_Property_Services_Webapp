import { PrismaAdapter } from "@auth/prisma-adapter";
import { Role } from "@prisma/client";
import bcrypt from "bcryptjs";
import type { NextAuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import { db } from "@/lib/db";

function getConfiguredAuthBaseUrl() {
  const raw =
    process.env.APP_BASE_URL?.trim() ||
    process.env.APP_URL?.trim() ||
    process.env.NEXTAUTH_URL?.trim() ||
    "";
  return raw.replace(/\/+$/, "");
}

function isLoopbackHost(hostname: string) {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "0.0.0.0";
}

function sameNormalizedOrigin(url: string, baseUrl: string) {
  try {
    const parsedUrl = new URL(url, baseUrl);
    const parsedBase = new URL(baseUrl);
    if (parsedUrl.origin === parsedBase.origin) return true;
    return (
      parsedUrl.port === parsedBase.port &&
      isLoopbackHost(parsedUrl.hostname) &&
      isLoopbackHost(parsedBase.hostname)
    );
  } catch {
    return false;
  }
}

function getBootstrapAdminConfig() {
  const email = process.env.BOOTSTRAP_ADMIN_EMAIL?.trim().toLowerCase() || "";
  const password = process.env.BOOTSTRAP_ADMIN_PASSWORD?.trim() || "";
  const name = process.env.BOOTSTRAP_ADMIN_NAME?.trim() || "Admin User";
  if (!email || !password) return null;
  return { email, password, name };
}

function shouldUseSecureCookies(baseUrl?: string) {
  const candidate = (baseUrl || getConfiguredAuthBaseUrl()).trim();
  if (!candidate) return false;
  try {
    const parsed = new URL(candidate);
    return parsed.protocol === "https:" && !isLoopbackHost(parsed.hostname);
  } catch {
    return false;
  }
}

function buildCookieConfig(secure: boolean): NextAuthOptions["cookies"] {
  return {
    sessionToken: {
      name: secure ? "__Secure-next-auth.session-token" : "next-auth.session-token",
      options: {
        httpOnly: true,
        sameSite: "lax",
        path: "/",
        secure,
      },
    },
    callbackUrl: {
      name: secure ? "__Secure-next-auth.callback-url" : "next-auth.callback-url",
      options: {
        httpOnly: true,
        sameSite: "lax",
        path: "/",
        secure,
      },
    },
    csrfToken: {
      name: secure ? "__Host-next-auth.csrf-token" : "next-auth.csrf-token",
      options: {
        httpOnly: true,
        sameSite: "lax",
        path: "/",
        secure,
      },
    },
  };
}

export function createAuthOptions(baseUrl?: string): NextAuthOptions {
  const secureCookies = shouldUseSecureCookies(baseUrl);

  return {
    // @ts-ignore PrismaAdapter type mismatch between next-auth v4 and @auth/prisma-adapter v2
    adapter: PrismaAdapter(db),
    session: {
      strategy: "jwt",
      maxAge: 60 * 60 * 8,
      updateAge: 60 * 30,
    },
    jwt: {
      maxAge: 60 * 60 * 8,
    },
    pages: {
      signIn: "/login",
      error: "/login",
    },
    cookies: buildCookieConfig(secureCookies),
    useSecureCookies: secureCookies,
    providers: [
      CredentialsProvider({
        name: "Credentials",
        credentials: {
          email: { label: "Email", type: "email" },
          password: { label: "Password", type: "password" },
        },
        async authorize(credentials) {
          if (!credentials?.email || !credentials?.password) return null;
          const email = credentials.email.toLowerCase();
          const bootstrapAdmin = getBootstrapAdminConfig();

          if (bootstrapAdmin && email === bootstrapAdmin.email && credentials.password === bootstrapAdmin.password) {
            const passwordHash = await bcrypt.hash(bootstrapAdmin.password, 10);
            const user = await db.user.upsert({
              where: { email },
              create: {
                email,
                name: bootstrapAdmin.name,
                role: Role.ADMIN,
                isActive: true,
                emailVerified: new Date(),
                passwordHash,
              },
              update: {
                name: bootstrapAdmin.name,
                role: Role.ADMIN,
                isActive: true,
                emailVerified: new Date(),
                passwordHash,
              },
            });

            return {
              id: user.id,
              email: user.email,
              name: user.name,
              image: user.image,
              role: user.role,
            };
          }

          const user = await db.user.findUnique({
            where: { email },
          });

          if (!user || !user.passwordHash || !user.isActive) return null;

          const valid = await bcrypt.compare(credentials.password, user.passwordHash);
          if (!valid) return null;

          return {
            id: user.id,
            email: user.email,
            name: user.name,
            image: user.image,
            role: user.role,
          };
        },
      }),
    ],
    callbacks: {
      async redirect({ url, baseUrl: nextAuthBaseUrl }) {
        if (url.startsWith("/")) return `${nextAuthBaseUrl}${url}`;
        if (sameNormalizedOrigin(url, nextAuthBaseUrl)) return url;
        const configuredBaseUrl = getConfiguredAuthBaseUrl();
        if (configuredBaseUrl && sameNormalizedOrigin(url, configuredBaseUrl)) return url;
        return configuredBaseUrl || nextAuthBaseUrl;
      },
      async jwt({ token, user }) {
        if (user) {
          token.id = user.id;
          token.role = (user as unknown as { role: Role }).role;
        }
        return token;
      },
      async session({ session, token }) {
        if (session.user) {
          session.user.id = token.id as string;
          session.user.role = token.role as Role;
        }
        return session;
      },
    },
  };
}

export const authOptions: NextAuthOptions = createAuthOptions();
