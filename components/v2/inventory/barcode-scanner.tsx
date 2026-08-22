"use client";

/**
 * THE CAMERA, AND THE ONE THING THAT MAKES IT USABLE.
 *
 * A decode loop pointed at a barcode does not fire once. It fires every frame —
 * thirty times a second, for as long as the label is in view. Without a
 * per-code cooldown, holding the phone steady on one bottle counts forty
 * bottles, and the cleaner's first count run produces numbers so obviously
 * wrong that they never trust the feature again.
 *
 * So the same code inside SCAN_COOLDOWN_MS is treated as one physical read.
 * Repeat scans of the same PRODUCT still count — that is the normal case, ten
 * identical bottles — but the cleaner has to move the phone away and come back,
 * which is exactly the deliberate gesture that makes the count mean something.
 *
 * TWO DECODERS, one interface. `BarcodeDetector` is built into Chrome on
 * Android and hands the work to the operating system: fast, and good in poor
 * light. Safari does not have it, and because every iOS browser is Safari
 * underneath, no iPhone does either. ZXing decodes in JavaScript and works
 * everywhere, more slowly. The native one is used where it exists and the
 * fallback is silent, because a cleaner does not care which decoder ran.
 *
 * MANUAL ENTRY IS NOT A FALLBACK, it is a permanent fixture. Barcodes get
 * scuffed, freezer labels ice over, and decanted or bulk items never had one.
 * A scanner that cannot be typed into strands somebody mid-count.
 */

import * as React from "react";
import { Camera, Keyboard, Loader2, X, Zap, ZapOff } from "lucide-react";
import { EButton } from "@/components/v2/ui/primitives";
import { EInput } from "@/components/v2/admin/estate-kit";

/**
 * How long the same code is ignored after a read.
 *
 * Long enough to swallow the burst of identical frames from one label; short
 * enough that a cleaner working quickly down a shelf is never blocked. 1.5s is
 * roughly the time it takes to move a phone from one bottle to the next.
 */
const SCAN_COOLDOWN_MS = 1500;

/** Formats worth decoding. Narrowing this speeds ZXing up considerably. */
const NATIVE_FORMATS = ["ean_13", "ean_8", "upc_a", "upc_e", "code_128", "code_39", "qr_code"];

type Decoder = "native" | "zxing" | null;

export function BarcodeScanner({
  onScan,
  onClose,
  /** Rendered over the camera — the running count, usually. */
  children,
}: {
  onScan: (code: string) => void;
  onClose?: () => void;
  children?: React.ReactNode;
}) {
  const videoRef = React.useRef<HTMLVideoElement | null>(null);
  const streamRef = React.useRef<MediaStream | null>(null);
  const lastSeenRef = React.useRef<Map<string, number>>(new Map());
  const stoppedRef = React.useRef(false);

  const [decoder, setDecoder] = React.useState<Decoder>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [starting, setStarting] = React.useState(true);
  const [manual, setManual] = React.useState("");
  const [showManual, setShowManual] = React.useState(false);
  const [torchOn, setTorchOn] = React.useState(false);
  const [torchAvailable, setTorchAvailable] = React.useState(false);

  /** One place decides whether a read counts, so both decoders behave alike. */
  const accept = React.useCallback(
    (raw: string) => {
      const code = raw.trim();
      if (!code) return;
      const now = Date.now();
      const last = lastSeenRef.current.get(code);
      if (last && now - last < SCAN_COOLDOWN_MS) return;
      lastSeenRef.current.set(code, now);

      // A short buzz is the only feedback that works here: the phone is held at
      // arm's length against a shelf, often in a dim cupboard, and the person
      // is looking at the bottle rather than at the screen.
      if (typeof navigator !== "undefined" && "vibrate" in navigator) {
        navigator.vibrate?.(40);
      }
      onScan(code);
    },
    [onScan]
  );

  React.useEffect(() => {
    stoppedRef.current = false;
    let cleanupDecoder: (() => void) | undefined;

    (async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          // The REAR camera. Defaulting to the front one points a cleaner's
          // phone at their own face while they hold it against a shelf.
          video: { facingMode: { ideal: "environment" } },
          audio: false,
        });
        if (stoppedRef.current) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play().catch(() => undefined);
        }

        const track = stream.getVideoTracks()[0];
        const capabilities = track?.getCapabilities?.() as { torch?: boolean } | undefined;
        setTorchAvailable(Boolean(capabilities?.torch));

        setStarting(false);

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const NativeDetector = (window as any).BarcodeDetector;
        if (NativeDetector) {
          setDecoder("native");
          const detector = new NativeDetector({ formats: NATIVE_FORMATS });
          let frame = 0;
          const tick = async () => {
            if (stoppedRef.current || !videoRef.current) return;
            try {
              const found = await detector.detect(videoRef.current);
              for (const result of found ?? []) {
                if (result?.rawValue) accept(String(result.rawValue));
              }
            } catch {
              // A single failed frame is not worth reporting; the next one
              // usually succeeds, and an error per frame would be unusable.
            }
            frame = requestAnimationFrame(tick);
          };
          frame = requestAnimationFrame(tick);
          cleanupDecoder = () => cancelAnimationFrame(frame);
          return;
        }

        // No native decoder — every iPhone, and any desktop browser but Chrome.
        setDecoder("zxing");
        const { BrowserMultiFormatReader } = await import("@zxing/browser");
        if (stoppedRef.current) return;
        const reader = new BrowserMultiFormatReader();
        const controls = await reader.decodeFromVideoElement(
          videoRef.current as HTMLVideoElement,
          (result) => {
            if (result) accept(result.getText());
          }
        );
        cleanupDecoder = () => controls.stop();
      } catch (err: any) {
        setStarting(false);
        setError(
          err?.name === "NotAllowedError"
            ? "Camera access was blocked. Allow it for this site, or type the codes instead."
            : "Could not start the camera. You can still type the codes."
        );
        // Typing is the only way forward from here, so open it rather than
        // leaving the person looking at a dead screen.
        setShowManual(true);
      }
    })();

    return () => {
      stoppedRef.current = true;
      cleanupDecoder?.();
      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    };
  }, [accept]);

  async function toggleTorch() {
    const track = streamRef.current?.getVideoTracks()[0];
    if (!track) return;
    try {
      const next = !torchOn;
      // Not in the standard MediaTrackConstraintSet typings, but supported on
      // the Android devices that have a torch at all — and a cleaner's cupboard
      // is very often the darkest place in the property.
      await track.applyConstraints({
        advanced: [{ torch: next }],
      } as unknown as MediaTrackConstraints);
      setTorchOn(next);
    } catch {
      setTorchAvailable(false);
    }
  }

  function submitManual(event: React.FormEvent) {
    event.preventDefault();
    const code = manual.trim();
    if (!code) return;
    // Bypasses the cooldown deliberately: typing the same code twice is two
    // deliberate acts, never a camera repeating itself.
    lastSeenRef.current.delete(code);
    accept(code);
    setManual("");
  }

  return (
    <div className="space-y-3">
      <div className="relative overflow-hidden rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] bg-black">
        {/* playsInline matters on iOS: without it Safari takes the video
            fullscreen and the running count disappears behind it. */}
        <video ref={videoRef} playsInline muted className="h-[46vh] w-full object-cover" />

        {starting ? (
          <div className="absolute inset-0 flex items-center justify-center gap-2 bg-black/60 text-white">
            <Loader2 className="h-5 w-5 animate-spin" /> Starting the camera…
          </div>
        ) : null}

        {/* A frame to aim with. Purely visual — the decoder reads the whole
            image — but people line a barcode up inside it, which steadies the
            phone and improves the read. */}
        {!starting && !error ? (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <div className="h-24 w-3/4 rounded-[var(--e-radius)] border-2 border-white/70" />
          </div>
        ) : null}

        <div className="absolute right-2 top-2 flex gap-1.5">
          {torchAvailable ? (
            <button
              type="button"
              onClick={toggleTorch}
              aria-label={torchOn ? "Turn the light off" : "Turn the light on"}
              className="rounded-full bg-black/60 p-2 text-white"
            >
              {torchOn ? <ZapOff className="h-4 w-4" /> : <Zap className="h-4 w-4" />}
            </button>
          ) : null}
          {onClose ? (
            <button
              type="button"
              onClick={onClose}
              aria-label="Close the scanner"
              className="rounded-full bg-black/60 p-2 text-white"
            >
              <X className="h-4 w-4" />
            </button>
          ) : null}
        </div>

        {children ? (
          <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 to-transparent p-3 text-white">
            {children}
          </div>
        ) : null}
      </div>

      {error ? (
        <p className="rounded-[var(--e-radius)] border border-[hsl(var(--e-warning)/0.4)] bg-[hsl(var(--e-warning)/0.1)] px-3 py-2 text-[0.8125rem]">
          {error}
        </p>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        <EButton variant="outline" size="sm" onClick={() => setShowManual((v) => !v)}>
          <Keyboard className="h-3.5 w-3.5" /> {showManual ? "Hide typing" : "Type a code"}
        </EButton>
        {decoder && !error ? (
          <span className="inline-flex items-center gap-1.5 text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
            <Camera className="h-3.5 w-3.5" />
            {decoder === "native" ? "Fast scanning" : "Scanning"}
          </span>
        ) : null}
      </div>

      {showManual ? (
        <form onSubmit={submitManual} className="flex gap-2">
          <EInput
            value={manual}
            onChange={(e) => setManual(e.target.value)}
            placeholder="Barcode number"
            inputMode="numeric"
            autoFocus
          />
          <EButton type="submit" variant="gold" size="sm">
            Add
          </EButton>
        </form>
      ) : null}
    </div>
  );
}
