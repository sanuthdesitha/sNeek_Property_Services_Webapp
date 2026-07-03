import { PrismaAdapter } from "@auth/prisma-adapter";
import { Role } from "@prisma/client";
import bcrypt from "bcryptjs";
import type { NextAuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import type { AuthenticationResponseJSON } from "@simplewebauthn/types";
import { db } from "@/lib/db";
import { getAppSettings } from "@/lib/settings";
import {
  AUTHENTICATE_CHALLENGE_COOKIE,
  decodeChallengeCookie,
  getRelyingParty,
  parseCookieHeader,
  verifyAssertionAndGetUser,
} from "@/lib/auth/webauthn";
import {
  TRUSTED_DEVICE_COOKIE,
  TWO_FA_OK_COOKIE,
  isTrustedDevice,
  readCookieFromHeader,
  verifyTwoFaOk,
} from "@/lib/auth/twofactor";
import {
  loginKey,
  ensureNotLockedOut,
  recordFailedAttempt,
  clearFailedAttempts,
} from "@/lib/auth/login-lockout";

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
        async authorize(credentials, req) {
          if (!credentials?.email || !credentials?.password) return null;
          const email = credentials.email.toLowerCase();
          // Brute-force lockout (survives serverless restarts via appSetting).
          const lock = await ensureNotLockedOut(loginKey(email));
          if (!lock.ok) throw new Error(lock.message);
          const bootstrapAdmin = getBootstrapAdminConfig();

          if (bootstrapAdmin && email === bootstrapAdmin.email && credentials.password === bootstrapAdmin.password) {
            await clearFailedAttempts(loginKey(email));
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

          if (!user || !user.passwordHash || !user.isActive) {
            await recordFailedAttempt(loginKey(email));
            return null;
          }

          const valid = await bcrypt.compare(credentials.password, user.passwordHash);
          if (!valid) {
            await recordFailedAttempt(loginKey(email));
            return null;
          }
          // Password correct — clear the counter. (A subsequent 2FA failure is
          // tracked separately under the 2FA lockout namespace.)
          await clearFailedAttempts(loginKey(email));

          // Optional 2FA gate. The login UI runs the second-factor check first
          // (via /api/auth/2fa/*) and sets a short-lived proof cookie, or the
          // device carries a long-lived "remembered" token. If 2FA is on and
          // neither is valid, deny — the UI is responsible for completing 2FA
          // before calling signIn.
          if (user.twoFactorEnabled) {
            const cookieHeader = (req?.headers?.cookie as string | undefined) ?? undefined;
            const trusted = await isTrustedDevice(
              user.id,
              readCookieFromHeader(cookieHeader, TRUSTED_DEVICE_COOKIE),
            );
            const passed = verifyTwoFaOk(
              readCookieFromHeader(cookieHeader, TWO_FA_OK_COOKIE),
              user.email,
            );
            if (!trusted && !passed) return null;
          }

          const settings = await getAppSettings();
          const maintenanceMode = settings.websiteContent.maintenanceMode;
          if (
            maintenanceMode.enabled === true &&
            maintenanceMode.allowLogin === false &&
            user.role !== Role.ADMIN &&
            user.role !== Role.OPS_MANAGER
          ) {
            return null;
          }

          return {
            id: user.id,
            email: user.email,
            name: user.name,
            image: user.image,
            role: user.role,
          };
        },
      }),
      // Passwordless biometric / passkey sign-in. The browser runs the WebAuthn
      // assertion ceremony then calls signIn("webauthn", { credential, email }).
      // We re-run the full @simplewebauthn verification HERE against the stored
      // public key + the challenge cookie, so there is no trust gap: a session is
      // only minted after a genuine assertion is verified server-side.
      CredentialsProvider({
        id: "webauthn",
        name: "Passkey",
        credentials: {
          credential: { label: "Credential", type: "text" },
          email: { label: "Email", type: "text" },
        },
        async authorize(credentials, req) {
          const raw = credentials?.credential;
          if (!raw || typeof raw !== "string") return null;

          let assertion: AuthenticationResponseJSON;
          try {
            assertion = JSON.parse(raw) as AuthenticationResponseJSON;
          } catch {
            return null;
          }

          const headers = (req?.headers ?? {}) as Record<string, unknown>;
          const { rpID, origin } = getRelyingParty(headers as Record<string, string>);

          const cookieHeader =
            (typeof headers.cookie === "string" && headers.cookie) ||
            (typeof headers.Cookie === "string" && (headers.Cookie as string)) ||
            "";
          const cookies = parseCookieHeader(cookieHeader);
          const expectedChallenge = decodeChallengeCookie(cookies[AUTHENTICATE_CHALLENGE_COOKIE]);
          if (!expectedChallenge) return null;

          const verifiedUser = await verifyAssertionAndGetUser({
            response: assertion,
            expectedChallenge,
            expectedOrigin: origin,
            expectedRPID: rpID,
          });
          if (!verifiedUser) return null;

          // Honour the same maintenance-mode gating as password login.
          const settings = await getAppSettings();
          const maintenanceMode = settings.websiteContent.maintenanceMode;
          if (
            maintenanceMode.enabled === true &&
            maintenanceMode.allowLogin === false &&
            verifiedUser.role !== Role.ADMIN &&
            verifiedUser.role !== Role.OPS_MANAGER
          ) {
            return null;
          }

          return {
            id: verifiedUser.id,
            email: verifiedUser.email,
            name: verifiedUser.name,
            image: verifiedUser.image,
            role: verifiedUser.role as Role,
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
