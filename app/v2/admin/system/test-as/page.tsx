import type { ReactNode } from "react";
import Link from "next/link";
import { cookies } from "next/headers";
import { Role } from "@prisma/client";
import { formatInTimeZone } from "date-fns-tz";
import { requireRealSession } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { getAppSettings } from "@/lib/settings";
import { EPageHeader } from "@/components/v2/ui/primitives";
import { ETonePill, toneMutedClass, toneNoticeClass } from "@/components/v2/ui/tone-band";
import { cn } from "@/lib/utils";
import { TestAsPicker, type TestAsCandidate } from "@/components/admin/test-as-picker";
import { TestAsLock } from "@/components/admin/test-as-lock";
import { TestAsLockNow } from "@/components/admin/test-as-lock-now";
import { TestAsModeTable } from "@/components/admin/test-as-mode-table";
import { TEST_AS_UNLOCK_COOKIE, isTestAsUnlocked, parseTestAsUnlockToken } from "@/lib/auth/test-as-unlock";
import { TESTABLE_PORTALS, testAsModeWords, type TestableRole } from "@/lib/auth/test-as-rules";
import { loadAccessSubject, realActorHolds } from "@/lib/rbac/delegated-admin";
import { accessWithin } from "@/lib/rbac/access-evaluator";
import { getOpsPolicy } from "@/lib/rbac/ops-access";

type TestableUser = { id: string; role: Role; extraRoles: Array<{ role: Role }> };

/** A delegated tester sees only people whose access does not exceed theirs (never themselves). */
async function usersWithinReach<T extends TestableUser>(actorId: string, candidates: T[]): Promise<T[]> {
  const [actor, policy] = await Promise.all([loadAccessSubject(actorId), getOpsPolicy()]);
  if (!actor) return [];
  return candidates.filter((user) =>
    user.id !== actorId &&
    accessWithin(policy, { id: user.id, role: user.role, heldRoles: [user.role, ...user.extraRoles.map((row) => row.role)] }, actor),
  );
}

export const metadata = { title: "Test as · Estate admin" };
export const dynamic = "force-dynamic";

/**
 * "See what they see" (board "Test as", 2026-11-17). Three gates, unchanged:
 * administrator (or the granted "Test as" capability), a PIN unlock for 15
 * minutes, and the mode chosen for each person.
 *
 * Gated on requireRealSession (not requireRole/requireSession): while
 * impersonating, the session role IS the target's, so a role check against the
 * swapped session would 403 the admin out of the page they need to get back.
 */

const ID_PATTERN = /^[a-zA-Z0-9_-]{1,128}$/;

function idParam(value: string | string[] | undefined): string | null {
  return typeof value === "string" && ID_PATTERN.test(value) ? value : null;
}

/** "last seen today 09:40", "last seen Fri 13 Nov", or "not seen yet" (organisation time). */
function lastSeenLabel(lastSeenAt: Date | null, now: Date, timeZone: string): string {
  if (!lastSeenAt) return "not seen yet";
  const today = formatInTimeZone(now, timeZone, "yyyy-MM-dd") === formatInTimeZone(lastSeenAt, timeZone, "yyyy-MM-dd");
  return today ? `last seen today ${formatInTimeZone(lastSeenAt, timeZone, "HH:mm")}` : `last seen ${formatInTimeZone(lastSeenAt, timeZone, "EEE d MMM")}`;
}

type StopNote = { targetName: string; modeWords: string; fromLabel: string; toLabel: string };

/** The session this person stopped in the last ten minutes, for "You are yourself again". */
async function recentStop(actorId: string, timeZone: string): Promise<StopNote | null> {
  const stop = await db.auditLog.findFirst({
    where: { userId: actorId, action: "IMPERSONATE_STOP", createdAt: { gte: new Date(Date.now() - 10 * 60 * 1000) } },
    orderBy: { createdAt: "desc" },
    select: { entityId: true, createdAt: true, after: true },
  });
  if (!stop?.entityId) return null;
  const after = (stop.after ?? {}) as { mode?: unknown; durationSeconds?: unknown };
  const target = await db.user.findUnique({ where: { id: stop.entityId }, select: { name: true, email: true } });
  const duration = typeof after.durationSeconds === "number" ? after.durationSeconds : 0;
  const started = new Date(stop.createdAt.getTime() - duration * 1000);
  return {
    targetName: target?.name || target?.email || "that person",
    modeWords: after.mode === "FULL" ? "full access" : testAsModeWords("READ_ONLY").short.toLowerCase(),
    fromLabel: formatInTimeZone(started, timeZone, "HH:mm"),
    toLabel: formatInTimeZone(stop.createdAt, timeZone, "HH:mm"),
  };
}

function YourselfAgain({ note, showActivityLink }: { note: StopNote; showActivityLink: boolean }) {
  return (
    <div role="status" className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-[var(--e-radius-lg)] bg-[hsl(var(--e-sidebar-bg))] px-4 py-3 text-[0.875rem] text-[hsl(var(--e-sidebar-fg))]">
      <p className="min-w-0 flex-1">
        <strong className="font-[650]">You are yourself again.</strong> Testing as {note.targetName}, {note.modeWords}, {note.fromLabel} to {note.toLabel}, is in the Activity log.
      </p>
      {showActivityLink ? (
        <Link href="/v2/admin/activity" className="font-[600] underline underline-offset-2">Activity log</Link>
      ) : null}
    </div>
  );
}

function RealDataNotice() {
  return (
    <div className={cn("rounded-[var(--e-radius-lg)] p-4", toneNoticeClass("attention"))}>
      <div className="flex items-start justify-between gap-3">
        <p className="text-[0.875rem] font-[600]">This is the real app, not a sandbox</p>
        <ETonePill tone="attention">Real data</ETonePill>
      </div>
      <p className={cn("mt-1 text-[0.8125rem]", toneMutedClass("attention"))}>
        View only is the safe default: every change is refused. Full access saves for real, under that person&apos;s name: clock-ins, form submissions, messages. A test ends by itself after one hour.
      </p>
    </div>
  );
}

function DelegatedNote() {
  return (
    <div className={cn("rounded-[var(--e-radius-lg)] p-4", toneNoticeClass("info"))}>
      <p className="text-[0.875rem] font-[600]">Someone given &ldquo;Test as&rdquo;</p>
      <p className={cn("mt-1 text-[0.8125rem]", toneMutedClass("info"))}>
        A person an administrator allowed to test sees only people with no more access than their own, never themselves.
      </p>
    </div>
  );
}

const HEADER = {
  eyebrow: "Settings · Access · administrators",
  title: "Test as",
  description: "Open a portal exactly as one of your people sees it, then come back. You stay signed in as yourself, and everything is recorded in the Activity log under your name.",
};

export default async function TestAsPage({
  searchParams,
}: {
  searchParams?: { user?: string | string[]; chosen?: string | string[]; relock?: string | string[]; stopped?: string | string[] };
}) {
  // Opened from a person in Accounts: show just that person (same guards, same picker).
  const focusId = idParam(searchParams?.user);
  const chosenId = idParam(searchParams?.chosen);
  const session = await requireRealSession();
  // An administrator, or a person an administrator granted "Test as" (owner
  // decision 2026-11-12), who then sees only people with no more access.
  const isAdmin = session.user.role === Role.ADMIN;
  if (!isAdmin && !(await realActorHolds(session.user.id, "access.test_as"))) {
    return (
      <div className="space-y-6">
        <EPageHeader eyebrow={HEADER.eyebrow} title={HEADER.title} />
        <div className={cn("rounded-[var(--e-radius-lg)] p-4 text-[0.875rem]", toneNoticeClass("problem"))}>
          Only an administrator, or someone they gave &ldquo;Test as&rdquo;, can open another portal for testing.
        </div>
      </div>
    );
  }

  const timeZone = (await getAppSettings().catch(() => null))?.timezone || "Australia/Sydney";
  const unlockToken = cookies().get(TEST_AS_UNLOCK_COOKIE)?.value;
  const unlocked = isTestAsUnlocked(unlockToken, session.user.id);
  const unlockedUntil = unlocked ? parseTestAsUnlockToken(unlockToken)?.expiresAt ?? null : null;
  const stopNote = searchParams?.stopped === "1" ? await recentStop(session.user.id, timeZone) : null;

  // Password lock. Being an ADMIN gets you to this page; it does not get you the
  // list. The unlock is a signed 15-minute cookie minted by
  // POST /api/admin/test-as/unlock — and POST /api/admin/impersonate demands it
  // too, so this is a real gate rather than a UI curtain.
  let picker: ReactNode;
  if (!unlocked) {
    picker = <TestAsLock relocked={searchParams?.relock === "1"} isAdministrator={isAdmin} />;
  } else {
    const now = new Date();
    const allUsers = await db.user.findMany({
      where: { isActive: true, role: { in: TESTABLE_PORTALS.map((portal) => portal.role as Role) } },
      select: { id: true, name: true, email: true, role: true, lastSeenAt: true, client: { select: { name: true } }, extraRoles: { select: { role: true } } },
      orderBy: [{ role: "asc" }, { name: "asc" }],
    });
    const users = isAdmin ? allUsers : await usersWithinReach(session.user.id, allUsers);
    const people: TestAsCandidate[] = users
      .filter((user) => !focusId || user.id === focusId)
      .map((user) => ({
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role as TestableRole,
        clientName: user.role === Role.CLIENT ? user.client?.name ?? null : null,
        lastSeenLabel: lastSeenLabel(user.lastSeenAt, now, timeZone),
      }));
    picker = (
      <>
        {focusId ? (
          <p className="text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">
            {people.length === 0 ? "That person cannot be tested as (only active, non-admin accounts can). " : "Showing one person from Accounts. "}
            <Link className="underline" href="/v2/admin/system/test-as">Show everyone</Link>
          </p>
        ) : null}
        <TestAsPicker people={people} timeZone={timeZone} chosenId={chosenId} />
      </>
    );
  }

  return (
    <div className="space-y-6">
      <EPageHeader
        eyebrow={HEADER.eyebrow}
        title={HEADER.title}
        description={HEADER.description}
        actions={unlockedUntil ? <TestAsLockNow untilLabel={formatInTimeZone(unlockedUntil, timeZone, "HH:mm")} /> : undefined}
      />
      {stopNote ? <YourselfAgain note={stopNote} showActivityLink={isAdmin} /> : null}
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="min-w-0 space-y-4">
          <RealDataNotice />
          {picker}
        </div>
        <div className="min-w-0 space-y-4">
          <TestAsModeTable />
          <DelegatedNote />
        </div>
      </div>
    </div>
  );
}
