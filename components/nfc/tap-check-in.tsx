"use client";

/**
 * The screen a cleaner sees for the two seconds after tapping a tag.
 *
 * It runs itself: the cleaner has already done the only thing being asked of
 * them, which was to hold their phone against the door. Making them then press
 * a button would be asking twice.
 *
 * Location is requested but never waited on for long and never required. The
 * whole point of the tag is that it works where GPS does not — a basement
 * carpark, a lift lobby, a stairwell — so a fix that has not arrived within a
 * few seconds is abandoned and the scan goes without it. The server records
 * whatever arrived.
 */

import * as React from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, Loader2, AlertTriangle } from "lucide-react";

/** Long enough for a real fix indoors, short enough not to feel broken. */
const LOCATION_TIMEOUT_MS = 5_000;

type Phase = "working" | "done" | "failed";

interface ScanResponse {
  outcome: string;
  action: "CHECK_IN" | "CHECK_OUT" | null;
  jobId: string | null;
  message: string;
}

function readPosition(): Promise<GeolocationPosition | null> {
  if (typeof navigator === "undefined" || !navigator.geolocation) return Promise.resolve(null);
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value: GeolocationPosition | null) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    // Belt and braces: some browsers never fire either callback when the
    // permission prompt is dismissed rather than answered.
    const timer = setTimeout(() => finish(null), LOCATION_TIMEOUT_MS);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        clearTimeout(timer);
        finish(position);
      },
      () => {
        clearTimeout(timer);
        finish(null);
      },
      { enableHighAccuracy: true, maximumAge: 0, timeout: LOCATION_TIMEOUT_MS }
    );
  });
}

export function TapCheckIn({ token }: { token: string }) {
  const router = useRouter();
  const [phase, setPhase] = React.useState<Phase>("working");
  const [message, setMessage] = React.useState("Checking you in…");
  const ranRef = React.useRef(false);

  React.useEffect(() => {
    // React 18 mounts effects twice in development, and a double scan would
    // read as a check-in immediately followed by a check-out.
    if (ranRef.current) return;
    ranRef.current = true;

    let cancelled = false;

    (async () => {
      const position = await readPosition();
      if (cancelled) return;

      try {
        const res = await fetch("/api/nfc/scan", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            token,
            ...(position
              ? {
                  lat: position.coords.latitude,
                  lng: position.coords.longitude,
                  accuracy: position.coords.accuracy ?? undefined,
                }
              : {}),
          }),
        });
        const body = (await res.json().catch(() => null)) as ScanResponse | null;
        if (cancelled) return;

        if (!body) {
          setPhase("failed");
          setMessage("Something went wrong reading that tag. Open the job from your schedule.");
          return;
        }

        setMessage(body.message);

        if (body.jobId) {
          setPhase("done");
          // Straight to the job. The tap recorded arrival; the normal start
          // flow — the read-first acknowledgement, the property code, the
          // laundry bag — still runs there, because those gates are about the
          // work rather than about where the cleaner is standing.
          router.replace(`/v2/cleaner/jobs/${body.jobId}`);
          return;
        }

        setPhase("failed");
      } catch {
        if (cancelled) return;
        setPhase("failed");
        setMessage("No connection. Open the job from your schedule and check in there.");
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [token, router]);

  return (
    <main className="flex min-h-[100dvh] flex-col items-center justify-center gap-4 px-6 text-center">
      {phase === "working" ? (
        <Loader2 className="h-10 w-10 animate-spin text-[hsl(var(--e-primary))]" aria-hidden />
      ) : phase === "done" ? (
        <CheckCircle2 className="h-10 w-10 text-[hsl(var(--e-success))]" aria-hidden />
      ) : (
        <AlertTriangle className="h-10 w-10 text-[hsl(var(--e-warning))]" aria-hidden />
      )}

      <p role="status" aria-live="polite" className="text-[1rem] font-[550]">
        {message}
      </p>

      {phase === "failed" ? (
        <a
          href="/v2/cleaner"
          className="mt-2 text-[0.9375rem] font-[550] text-[hsl(var(--e-primary))] underline underline-offset-2"
        >
          Go to my schedule
        </a>
      ) : null}
    </main>
  );
}
