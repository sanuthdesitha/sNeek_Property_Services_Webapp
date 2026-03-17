import { NextAuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import { PrismaAdapter } from "@auth/prisma-adapter";
import bcrypt from "bcryptjs";
import { db } from "@/lib/db";
import { Role } from "@prisma/client";

function getBootstrapAdminConfig() {
  const email = process.env.BOOTSTRAP_ADMIN_EMAIL?.trim().toLowerCase() || "";
  const password = process.env.BOOTSTRAP_ADMIN_PASSWORD?.trim() || "";
  const name = process.env.BOOTSTRAP_ADMIN_NAME?.trim() || "Admin User";
  if (!email || !password) return null;
  return { email, password, name };
}

export const authOptions: NextAuthOptions = {
  // @ts-ignore – PrismaAdapter type mismatch between next-auth v4 + @auth/prisma-adapter v2
  adapter: PrismaAdapter(db),
  session: {
    strategy: "jwt",
    maxAge: 60 * 60 * 8,
    updateAge: 60 * 30,
  },
  jwt: {
    maxAge: 60 * 60 * 8,
  },
  useSecureCookies: process.env.NODE_ENV === "production",
  pages: {
    signIn: "/login",
    error: "/login",
  },
  cookies: {
    sessionToken: {
      name:
        process.env.NODE_ENV === "production"
          ? "__Secure-next-auth.session-token"
          : "next-auth.session-token",
      options: {
        httpOnly: true,
        sameSite: "lax",
        path: "/",
        secure: process.env.NODE_ENV === "production",
      },
    },
    csrfToken: {
      name:
        process.env.NODE_ENV === "production"
          ? "__Host-next-auth.csrf-token"
          : "next-auth.csrf-token",
      options: {
        httpOnly: true,
        sameSite: "lax",
        path: "/",
        secure: process.env.NODE_ENV === "production",
      },
    },
  },
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
    async jwt({ token, user }) {
      if (user) {
        token.id = user.id;
        token.role = (user as any).role as Role;
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
