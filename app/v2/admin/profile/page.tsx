import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { Role } from "@prisma/client";
import { formatInTimeZone } from "date-fns-tz";
import { authOptions } from "@/lib/auth/auth-options";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { EPageHeader } from "@/components/v2/ui/primitives";
import { ProfileWorkspace, type ProfileSummaries } from "@/components/v2/admin/profile/profile-workspace";
import type { DensityChoice, ThemeChoice } from "@/components/v2/admin/profile/profile-cards";
import { getAppSettings, NOTIFICATION_CATEGORIES, NOTIFICATION_CATEGORY_META } from "@/lib/settings";
import { SEND_TRANSPORT_KIND_LABEL } from "@/lib/notifications/send-transport-kinds";

export const metadata = { title: "Your profile · Estate admin" };
export const dynamic = "force-dynamic";

const ROLE_WORD: Partial<Record<Role, string>> = { [Role.ADMIN]: "Administrator", [Role.OPS_MANAGER]: "Operations manager" };

function themeOf(value: unknown): ThemeChoice {
  return value === "LIGHT" || value === "DARK" ? value : "SYSTEM";
}

function densityOf(value: unknown): DensityChoice {
  return value === "COMPACT" || value === "COMFORTABLE" ? value : "DEFAULT";
}

/**
 * Your profile (administrators and operations managers): one page of cards
 * (board "Your profile"). Always the genuinely signed-in person's own account,
 * read from their own session token, never the account being tested as; while
 * testing, every change is refused (the routes refuse too). No banking for
 * office accounts.
 */
export default async function AdminProfilePage({ searchParams }: { searchParams?: Record<string, string | string[] | undefined> }) {
  const guarded = await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) redirect("/login");
  const userId = session.user.id;

  const [user, settings, passwordAudit, pin, passkeys, liveSessions, sendingRow] = await Promise.all([
    db.user.findUnique({
      where: { id: userId },
      select: {
        name: true, email: true, phone: true, role: true, address: true, suburb: true, state: true, postcode: true,
        uiDensity: true, themePreference: true, twoFactorEnabled: true, twoFactorMethod: true,
      },
    }),
    getAppSettings().catch(() => null),
    db.auditLog.findFirst({ where: { userId, action: "OWN_PASSWORD_CHANGED" }, orderBy: { createdAt: "desc" }, select: { createdAt: true } }).catch(() => null),
    db.userSecurityPin.findUnique({ where: { userId }, select: { pinHash: true } }).catch(() => undefined),
    db.webAuthnCredential.count({ where: { userId } }).catch(() => null),
    db.userSignIn.count({ where: { userId, revokedAt: null, lastActiveAt: { gte: new Date(Date.now() - 8 * 3_600_000) } } }).catch(() => null),
    db.appSetting.findUnique({ where: { key: `office_send_transports_v1:${userId}` }, select: { value: true } }).catch(() => undefined),
  ]);
  if (!user) redirect("/login");

  const timeZone = settings?.timezone || "Australia/Sydney";
  const theme = themeOf(user.themePreference);
  const density = densityOf(user.uiDensity);
  const passwordChanged = passwordAudit ? formatInTimeZone(passwordAudit.createdAt, timeZone, "d MMM yyyy") : null;
  const savedKinds = sendingRow === undefined ? null : Object.keys(((sendingRow?.value as { kinds?: Record<string, unknown> } | null)?.kinds) ?? {}).length;
  const summaries: ProfileSummaries = {
    details: [user.suburb, user.phone].filter(Boolean).join(" · ") || "Name, mobile and address",
    look: theme === "SYSTEM" ? "Match system" : theme === "DARK" ? "Dark" : "Light",
    password: passwordChanged ? `changed ${passwordChanged}` : "change not recorded",
    "own-pin": pin === undefined ? "–" : pin?.pinHash ? "Set" : "Not set",
    "two-step": user.twoFactorEnabled ? `On, ${user.twoFactorMethod === "EMAIL" ? "email" : "app"}` : "Off",
    passkeys: passkeys === null ? "–" : String(passkeys),
    sessions: liveSessions === null ? "–" : String(liveSessions),
    notifications: `${NOTIFICATION_CATEGORIES.length} kinds`,
    sending: savedKinds === null ? "–" : `${savedKinds} saved`,
  };
  const roleWord = ROLE_WORD[user.role] ?? "Office account";
  const setup = Array.isArray(searchParams?.setup) ? searchParams?.setup[0] : searchParams?.setup;

  return (
    <div className="space-y-6">
      <EPageHeader
        eyebrow="Your account"
        title="Your profile"
        description={`${user.name ?? user.email} · ${roleWord} · ${user.email}. These settings are yours alone; nobody else's account changes here.`}
      />
      <ProfileWorkspace
        details={{
          name: user.name ?? "",
          email: user.email,
          phone: user.phone ?? "",
          address: user.address ?? "",
          suburb: user.suburb ?? "",
          state: user.state ?? "",
          postcode: user.postcode ?? "",
        }}
        theme={theme}
        density={density}
        passwordChanged={passwordChanged}
        timeZone={timeZone}
        categories={NOTIFICATION_CATEGORIES.map((key) => ({ key, ...NOTIFICATION_CATEGORY_META[key] }))}
        sendingKindLabels={{ ...SEND_TRANSPORT_KIND_LABEL }}
        summaries={summaries}
        testingAsName={guarded.impersonation ? guarded.user.name ?? guarded.user.email ?? "someone else" : null}
        twoStepPrompted={setup === "two-step"}
      />
    </div>
  );
}
