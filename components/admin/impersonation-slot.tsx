import { cookies } from "next/headers";
import { getServerSession } from "next-auth";
import { formatInTimeZone } from "date-fns-tz";
import { authOptions } from "@/lib/auth/auth-options";
import { resolveImpersonation } from "@/lib/auth/impersonation-server";
import { TEST_AS_ENDED_COOKIE, impersonationEndsAt, readTestAsEndedMarker } from "@/lib/auth/impersonation";
import { testableRoleLabel } from "@/lib/auth/test-as-rules";
import { getAppSettings } from "@/lib/settings";
import { ImpersonationBar } from "./impersonation-bar";
import { TestAsEndedNote } from "./test-as-ended-note";

export type ImpersonationBanner = {
  targetName: string;
  targetShortName: string;
  targetRoleLabel: string;
  mode: "READ_ONLY" | "FULL";
  endsAtLabel: string;
};

/** "Marco Rossi" → "Marco R." for the phone banner. */
export function shortName(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length < 2 || name.includes("@")) return name;
  return `${words[0]} ${words[words.length - 1][0]}.`;
}

async function organisationTimeZone(): Promise<string> {
  return (await getAppSettings().catch(() => null))?.timezone || "Australia/Sydney";
}

/**
 * Server half of the impersonation banner, mounted in the root layout so the
 * bar follows the admin into every portal, v1 and v2 alike.
 *
 * Uses the RAW session (not requireSession) because it needs the real signed-in
 * id to validate the ticket against — requireSession would already have swapped
 * the identity out. Returns null with no database work when no ticket cookie is
 * present, so the public marketing pages pay nothing for this.
 */
export async function getImpersonationBanner(): Promise<ImpersonationBanner | null> {
  const session = await getServerSession(authOptions);
  const realId = session?.user?.id;
  if (!realId) return null;

  const impersonation = await resolveImpersonation(realId);
  if (!impersonation) return null;

  const targetName = impersonation.target.name || impersonation.target.email || "user";
  return {
    targetName,
    targetShortName: shortName(targetName),
    targetRoleLabel: testableRoleLabel(impersonation.target.role),
    mode: impersonation.mode,
    endsAtLabel: formatInTimeZone(impersonationEndsAt(impersonation.ticket), await organisationTimeZone(), "HH:mm"),
  };
}

export type TestAsEnded = { targetName: string };

/**
 * "Your test as Marco Rossi ended after one hour" (board "Test as"): shown on
 * the first page load after a session ran out, to the same administrator. The
 * marker cookie only remembers the session; it grants nothing.
 */
export async function getTestAsEnded(): Promise<TestAsEnded | null> {
  const raw = cookies().get(TEST_AS_ENDED_COOKIE)?.value;
  if (!raw) return null;
  const session = await getServerSession(authOptions);
  const realId = session?.user?.id;
  if (!realId) return null;
  const marker = await readTestAsEndedMarker(raw);
  if (!marker || marker.actorId !== realId || marker.endsAt > Date.now()) return null;
  return { targetName: marker.targetName };
}

export function ImpersonationSlot({ banner }: { banner: ImpersonationBanner }) {
  return <ImpersonationBar {...banner} />;
}

export function TestAsEndedSlot({ ended }: { ended: TestAsEnded }) {
  return <TestAsEndedNote targetName={ended.targetName} />;
}
