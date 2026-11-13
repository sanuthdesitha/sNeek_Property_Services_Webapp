"use client";

/**
 * The live-location start requirements for the CLASSIC cleaner job page
 * (the Estate portal uses components/v2/location/location-gate.tsx): the
 * current notice must be accepted (shown in a confirm with the same text) and
 * the phone must give a fix. Plain browser dialogs, because the classic page
 * has no Estate dialog kit.
 */
import { getAccuratePosition, GpsError } from "@/lib/geo/get-position";
import { LOCATION_NOTICE_TEXT, LOCATION_NOTICE_VERSION } from "./notice";
import { OFF_SITE_REASON_CODES } from "./off-site-reasons";

export type ClassicGateResult =
  | { ok: true; fix: { lat: number; lng: number; accuracy: number | null } | null }
  | { ok: false; message: string };

export async function ensureClassicLocationReady(): Promise<ClassicGateResult> {
  let status: { acknowledged?: boolean; version?: number; impersonating?: boolean } | null = null;
  try {
    const res = await fetch("/api/me/location-notice", { cache: "no-store" });
    status = res.ok ? await res.json() : null;
  } catch {
    status = null;
  }
  if (status?.impersonating) return { ok: true, fix: null };
  if (!(status?.acknowledged === true && status.version === LOCATION_NOTICE_VERSION)) {
    const text = LOCATION_NOTICE_TEXT.CLEANER;
    const accepted = window.confirm([text.title, "", text.why, "", ...text.when, "", ...text.who, "", ...text.limits, "", "Press OK to accept."].join("\n"));
    if (!accepted) return { ok: false, message: "Accept how your location is used to start." };
    const res = await fetch("/api/me/location-notice", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ version: LOCATION_NOTICE_VERSION }),
    }).catch(() => null);
    if (!res?.ok) return { ok: false, message: "Could not record that you accepted. Try again." };
  }
  try {
    const fix = await getAccuratePosition();
    return { ok: true, fix: { lat: fix.lat, lng: fix.lng, accuracy: fix.accuracy } };
  } catch (error) {
    return { ok: false, message: error instanceof GpsError ? error.message : "Location is unavailable on this device." };
  }
}

/** Ask for a coded off-site reason (numbered list); null when cancelled. */
export function pickClassicOffSiteReason(message: string): { reasonCode: string; note: string } | null {
  const lines = OFF_SITE_REASON_CODES.map((reason, index) => `${index + 1}. ${reason.label}`);
  const answer = window.prompt(`${message}\n\n${lines.join("\n")}\n\nType the number of the reason:`);
  const index = answer ? Number.parseInt(answer, 10) - 1 : -1;
  const reason = OFF_SITE_REASON_CODES[index];
  if (!reason) return null;
  const note = window.prompt("Anything the office should know? (optional)") ?? "";
  return { reasonCode: reason.code, note: note.trim() };
}
