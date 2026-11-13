"use client";

/**
 * Live location is mandatory to START (on the way, clock-in or resume for a
 * cleaner; starting a route for a laundry driver) — default pending owner
 * confirmation, 2026-11-14. Before any of those, `ensureReady()`:
 *
 *  1. reads whether this person accepted the CURRENT live-location notice
 *     (GET /api/me/location-notice) and, if not, shows it: why, when it is on,
 *     who sees it, the limits — "I understand" records the acknowledgement
 *     (POST, versioned; the server refuses a start without it);
 *  2. asks the phone for a fix (getAccuratePosition). A denial shows how to
 *     turn location back on, and the start does not happen.
 *
 * Resolves the fix, or null when the person cancelled or location is off. It
 * never blocks FINISHING work (stop, submit): callers use it only on starts.
 */
import * as React from "react";
import { EActionDialog } from "@/components/v2/ui/action-dialog";
import { EButton } from "@/components/v2/ui/primitives";
import { toneMutedClass, toneNoticeClass } from "@/components/v2/ui/tone-band";
import { getAccuratePosition, GpsError } from "@/lib/geo/get-position";
import { LOCATION_NOTICE_TEXT, LOCATION_NOTICE_VERSION, type NoticePortal } from "@/lib/gps/notice";

export type GateFix = { lat: number; lng: number; accuracy: number | null };
/** No location is needed: an administrator is viewing as this person. */
export const LOCATION_NOT_REQUIRED = "NOT_REQUIRED" as const;
export type GateResult = GateFix | typeof LOCATION_NOT_REQUIRED | null;

type DialogState =
  | { kind: "closed" }
  | { kind: "notice"; busy: boolean; error: string | null }
  | { kind: "blocked"; message: string };

const PERMISSION_STEPS = [
  "iPhone: Settings → Privacy & Security → Location Services → your browser (or sNeek) → While Using the App, and turn on Precise Location.",
  "Android: tap the lock icon beside the address (or Settings → Apps → sNeek → Permissions) → Location → Allow, and turn on Use precise location.",
  "Then come back here and try again.",
];

export function useLocationGate(portal: NoticePortal) {
  const [dialog, setDialog] = React.useState<DialogState>({ kind: "closed" });
  const resolver = React.useRef<((accepted: boolean) => void) | null>(null);
  const acknowledged = React.useRef(false);

  const finishNotice = React.useCallback((accepted: boolean) => {
    resolver.current?.(accepted);
    resolver.current = null;
  }, []);

  const askNotice = React.useCallback(
    () => new Promise<boolean>((resolve) => {
      resolver.current = resolve;
      setDialog({ kind: "notice", busy: false, error: null });
    }),
    [],
  );

  const accept = React.useCallback(async () => {
    setDialog({ kind: "notice", busy: true, error: null });
    try {
      const res = await fetch("/api/me/location-notice", {
        method: "POST",
        headers: { "content-type": "application/json", "x-progress-toast": "off" },
        body: JSON.stringify({ version: LOCATION_NOTICE_VERSION }),
      });
      const body = (await res.json().catch(() => null)) as { message?: string; error?: string } | null;
      if (!res.ok) throw new Error(body?.message ?? body?.error ?? "Could not record that you accepted. Try again.");
      acknowledged.current = true;
      setDialog({ kind: "closed" });
      finishNotice(true);
    } catch (error) {
      setDialog({ kind: "notice", busy: false, error: error instanceof Error ? error.message : "Could not record that you accepted. Try again." });
    }
  }, [finishNotice]);

  const cancelNotice = React.useCallback(() => {
    setDialog({ kind: "closed" });
    finishNotice(false);
  }, [finishNotice]);

  /**
   * Notice accepted and a fix in hand; LOCATION_NOT_REQUIRED while an
   * administrator is viewing as this person; null when nothing should start.
   */
  const ensureReady = React.useCallback(async (): Promise<GateResult> => {
    if (!acknowledged.current) {
      let known = false;
      try {
        const res = await fetch("/api/me/location-notice", { cache: "no-store", headers: { "x-progress-toast": "off" } });
        const body = (await res.json().catch(() => null)) as { acknowledged?: boolean; version?: number; impersonating?: boolean } | null;
        if (res.ok && body?.impersonating === true) return LOCATION_NOT_REQUIRED;
        known = res.ok && body?.acknowledged === true && body.version === LOCATION_NOTICE_VERSION;
      } catch {
        known = false;
      }
      if (known) acknowledged.current = true;
      else if (!(await askNotice())) return null;
    }
    try {
      const fix = await getAccuratePosition();
      return { lat: fix.lat, lng: fix.lng, accuracy: fix.accuracy };
    } catch (error) {
      const message = error instanceof GpsError ? error.message : "Location is unavailable on this device.";
      setDialog({ kind: "blocked", message });
      return null;
    }
  }, [askNotice]);

  /** A start route answered LOCATION_NOTICE_REQUIRED (version changed): ask again next time. */
  const forgetAcknowledgement = React.useCallback(() => {
    acknowledged.current = false;
  }, []);

  const text = LOCATION_NOTICE_TEXT[portal];
  const element = (
    <>
      <EActionDialog
        open={dialog.kind === "notice"}
        title={text.title}
        eyebrow="Live location"
        busy={dialog.kind === "notice" && dialog.busy}
        onClose={cancelNotice}
        footer={(
          <div className="flex flex-wrap justify-end gap-2">
            <EButton variant="ghost" onClick={cancelNotice} disabled={dialog.kind === "notice" && dialog.busy}>Not now</EButton>
            <EButton onClick={() => void accept()} disabled={dialog.kind === "notice" && dialog.busy}>
              {dialog.kind === "notice" && dialog.busy ? "Saving…" : "I understand"}
            </EButton>
          </div>
        )}
      >
        <div className="space-y-3 text-[0.875rem]">
          <p>{text.why}</p>
          <div>
            <p className="font-semibold">When it is on</p>
            <ul className="list-disc space-y-1 pl-5">{text.when.map((line) => <li key={line}>{line}</li>)}</ul>
          </div>
          <div>
            <p className="font-semibold">Who sees it</p>
            <ul className="list-disc space-y-1 pl-5">{text.who.map((line) => <li key={line}>{line}</li>)}</ul>
          </div>
          <div>
            <p className="font-semibold">Good to know</p>
            <ul className="list-disc space-y-1 pl-5">{text.limits.map((line) => <li key={line}>{line}</li>)}</ul>
          </div>
          {dialog.kind === "notice" && dialog.error ? (
            <p role="alert" className={`rounded-[var(--e-radius)] p-2 text-[0.8125rem] ${toneNoticeClass("problem")}`}>{dialog.error}</p>
          ) : null}
        </div>
      </EActionDialog>
      <EActionDialog
        open={dialog.kind === "blocked"}
        title="Turn on location to start"
        eyebrow="Live location"
        onClose={() => setDialog({ kind: "closed" })}
        footer={<div className="flex justify-end"><EButton onClick={() => setDialog({ kind: "closed" })}>OK</EButton></div>}
      >
        <div className="space-y-3 text-[0.875rem]">
          <p className={`rounded-[var(--e-radius)] p-2 ${toneNoticeClass("attention")}`}>
            {dialog.kind === "blocked" ? dialog.message : null}
            <span className={`block ${toneMutedClass("attention")}`}>Your location is needed to start. You can still finish work you have already started.</span>
          </p>
          <ul className="list-disc space-y-1 pl-5">{PERMISSION_STEPS.map((line) => <li key={line}>{line}</li>)}</ul>
        </div>
      </EActionDialog>
    </>
  );

  return { ensureReady, forgetAcknowledgement, element };
}
