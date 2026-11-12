"use client";

/**
 * Barcode / QR question on the cleaner form: a text box that always works,
 * plus a "Scan with camera" button.
 *
 * - The browser's BarcodeDetector is used where it exists (Chrome on
 *   Android). Elsewhere the ZXing decoder already in the app
 *   (@zxing/browser, also used by the stock scanner) reads the camera.
 * - No camera, camera permission refused, or the decoder failing to load →
 *   the scanner closes with a plain message and the text box stays: the form
 *   is never blocked.
 * - The answer stays a plain string (what reports and rules read). How it was
 *   captured is reported through `onCapture` ("camera" or "manual") and stored
 *   by the renderer under the reserved `__barcodeCapture` answer key.
 */
import * as React from "react";
import { Camera, X } from "lucide-react";
import { EInput } from "@/components/v2/cleaner/fields";
import { EButton } from "@/components/v2/ui/primitives";

export type BarcodeCaptureMethod = "camera" | "manual";
export type BarcodeCapture = { method: BarcodeCaptureMethod; decoder?: "native" | "zxing" };

/** Reserved answer key holding `{ [fieldId]: BarcodeCapture }`. */
export const BARCODE_CAPTURE_KEY = "__barcodeCapture";

type DetectorResult = { rawValue?: string };
type NativeDetector = { detect: (source: HTMLVideoElement) => Promise<DetectorResult[]> };
type NativeDetectorCtor = new (options?: { formats?: string[] }) => NativeDetector;

const FORMATS = ["ean_13", "ean_8", "upc_a", "upc_e", "code_128", "code_39", "qr_code", "data_matrix"];

export type ScannerSupport = "native" | "zxing" | "none";

/** What this browser can do, without asking for permission. */
export function scannerSupport(win: { BarcodeDetector?: unknown; navigator?: { mediaDevices?: { getUserMedia?: unknown } } } | undefined): ScannerSupport {
  if (!win?.navigator?.mediaDevices?.getUserMedia) return "none";
  return typeof win.BarcodeDetector === "function" ? "native" : "zxing";
}

export function cameraErrorMessage(error: unknown): string {
  const name = (error as { name?: string } | null)?.name;
  if (name === "NotAllowedError" || name === "SecurityError") {
    return "Camera access was blocked, so the code can't be scanned. Type it in the box instead.";
  }
  if (name === "NotFoundError" || name === "OverconstrainedError") {
    return "No camera was found on this device. Type the code in the box instead.";
  }
  return "The camera could not start. Type the code in the box instead.";
}

function CameraPanel({ onDetected, onFail, onClose }: { onDetected: (code: string, decoder: "native" | "zxing") => void; onFail: (message: string) => void; onClose: () => void }) {
  const videoRef = React.useRef<HTMLVideoElement | null>(null);

  React.useEffect(() => {
    let stopped = false;
    let stream: MediaStream | null = null;
    let stopDecoder: (() => void) | undefined;
    const finish = (code: string, decoder: "native" | "zxing") => {
      if (stopped) return;
      stopped = true;
      onDetected(code, decoder);
    };
    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" } }, audio: false });
        if (stopped || !videoRef.current) return;
        videoRef.current.srcObject = stream;
        await videoRef.current.play().catch(() => undefined);
        const Native = (window as unknown as { BarcodeDetector?: NativeDetectorCtor }).BarcodeDetector;
        if (typeof Native === "function") {
          const detector = new Native({ formats: FORMATS });
          let frame = 0;
          const tick = async () => {
            if (stopped || !videoRef.current) return;
            try {
              const found = await detector.detect(videoRef.current);
              const code = found.find((result) => typeof result.rawValue === "string" && result.rawValue.trim())?.rawValue;
              if (code) return finish(code.trim(), "native");
            } catch {
              // One unreadable frame is normal; keep looking.
            }
            frame = requestAnimationFrame(() => void tick());
          };
          frame = requestAnimationFrame(() => void tick());
          stopDecoder = () => cancelAnimationFrame(frame);
          return;
        }
        const { BrowserMultiFormatReader } = await import("@zxing/browser");
        if (stopped || !videoRef.current) return;
        const controls = await new BrowserMultiFormatReader().decodeFromVideoElement(videoRef.current, (result) => {
          const code = result?.getText()?.trim();
          if (code) finish(code, "zxing");
        });
        stopDecoder = () => controls.stop();
      } catch (error) {
        if (!stopped) onFail(cameraErrorMessage(error));
      }
    })();
    return () => {
      stopped = true;
      stopDecoder?.();
      stream?.getTracks().forEach((track) => track.stop());
    };
  }, [onDetected, onFail]);

  return (
    <div className="relative overflow-hidden rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] bg-black">
      <video ref={videoRef} playsInline muted aria-label="Camera view for scanning" className="h-48 w-full object-cover" />
      <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
        <div className="h-16 w-3/4 rounded-[var(--e-radius)] border-2 border-white/70" />
      </div>
      <button type="button" onClick={onClose} aria-label="Close the scanner" className="absolute right-2 top-2 rounded-full bg-black/60 p-2 text-white">
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}

export function BarcodeFieldInput({
  label,
  value,
  onChange,
  onCapture,
  disabled,
  errorClassName,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  onCapture: (capture: BarcodeCapture) => void;
  disabled?: boolean;
  errorClassName?: string;
  placeholder?: string;
}) {
  const [scanning, setScanning] = React.useState(false);
  const [notice, setNotice] = React.useState<string | null>(null);

  const startScan = () => {
    const support = scannerSupport(typeof window === "undefined" ? undefined : (window as never));
    if (support === "none") {
      setNotice("This device's browser can't use the camera to scan. Type the code in the box instead.");
      return;
    }
    setNotice(null);
    setScanning(true);
  };
  const onDetected = React.useCallback(
    (code: string, decoder: "native" | "zxing") => {
      setScanning(false);
      onChange(code);
      onCapture({ method: "camera", decoder });
    },
    [onChange, onCapture],
  );
  const onFail = React.useCallback((message: string) => {
    setScanning(false);
    setNotice(message);
  }, []);
  const onClose = React.useCallback(() => setScanning(false), []);

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <EInput
          aria-label={label}
          placeholder={placeholder || "Scan or type the code"}
          value={value}
          disabled={disabled}
          className={errorClassName}
          onChange={(event) => {
            onChange(event.target.value);
            onCapture({ method: "manual" });
          }}
        />
        <EButton type="button" variant="outline" size="sm" disabled={disabled || scanning} onClick={startScan}>
          <Camera className="h-4 w-4" /> Scan
        </EButton>
      </div>
      {scanning ? <CameraPanel onDetected={onDetected} onFail={onFail} onClose={onClose} /> : null}
      {notice ? (
        <p role="status" className="text-[0.75rem] text-[hsl(var(--e-warning))]">
          {notice}
        </p>
      ) : null}
    </div>
  );
}
