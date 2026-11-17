/**
 * One multipart part transfer with a STALL deadline instead of a total one.
 *
 * A fixed total deadline (it was 120 seconds) fails every 5 MB part on an
 * uplink slower than about 42 KB/s, however healthy that connection is, so the
 * same video worked on one cleaner's phone and failed on another's. A part now
 * fails only when no bytes have moved for `stallMs`, or when it exceeds a very
 * generous `ceilingMs` so a socket that trickles forever still releases.
 *
 * Byte movement needs upload progress, which fetch cannot report, so this uses
 * XMLHttpRequest. Where XHR is unavailable it falls back to fetch bounded by the
 * ceiling alone, because without progress a stall cannot be told apart from a
 * slow transfer.
 */
import { uploadRequest } from "./request";

export interface PartTransferRequest {
  url: string;
  body: Blob;
  headers?: Record<string, string>;
  signal?: AbortSignal;
  /** A part fails when no bytes move for this long. */
  stallMs: number;
  /** Absolute bound for one attempt, whatever its progress. */
  ceilingMs: number;
  /** Bytes of this attempt handed to the network so far (monotonic per attempt). */
  onBytes?: (loaded: number) => void;
  /** Parse a successful response body as JSON (the application's proxy receipt). */
  parseJson?: boolean;
}

export interface PartTransferResponse {
  status: number;
  etag: string | null;
  /** Response text, used only to classify storage errors; never logged. */
  body: string;
  /** Parsed JSON for a successful `parseJson` request. */
  json?: unknown;
  /** Whether byte progress was observable (XHR) or only completion (fetch). */
  observedProgress: boolean;
}

export type PartTransferFailureKind = "stall" | "ceiling" | "network";

/** A transfer that did not produce an HTTP response. */
export class PartTransferError extends Error {
  readonly kind: PartTransferFailureKind;
  /** Bytes this attempt sent before it failed. */
  readonly bytesSent: number;
  constructor(kind: PartTransferFailureKind, message: string, bytesSent: number) {
    super(message);
    this.name = "PartTransferError";
    this.kind = kind;
    this.bytesSent = bytesSent;
  }
}

/** After the last byte leaves, allow this many stall windows for the answer. */
const RESPONSE_WAIT_STALL_WINDOWS = 2;

function pageIsHidden(): boolean {
  return typeof document !== "undefined" && document.visibilityState === "hidden";
}

function abortReason(signal: AbortSignal): unknown {
  return signal.reason ?? new DOMException("The upload was cancelled.", "AbortError");
}

export function sendPart(request: PartTransferRequest): Promise<PartTransferResponse> {
  if (typeof XMLHttpRequest === "undefined") return sendPartWithFetch(request);
  return sendPartWithXhr(request);
}

function sendPartWithXhr(request: PartTransferRequest): Promise<PartTransferResponse> {
  const { url, body, headers, signal, stallMs, ceilingMs, onBytes } = request;
  return new Promise<PartTransferResponse>((resolve, reject) => {
    if (signal?.aborted) {
      reject(abortReason(signal));
      return;
    }
    const xhr = new XMLHttpRequest();
    const startedAt = Date.now();
    let bytesSent = 0;
    let bodySent = false;
    let settled = false;
    let stallTimer: ReturnType<typeof setTimeout> | undefined;
    let ceilingTimer: ReturnType<typeof setTimeout> | undefined;

    const cleanup = () => {
      settled = true;
      clearTimeout(stallTimer);
      clearTimeout(ceilingTimer);
      signal?.removeEventListener("abort", onCallerAbort);
    };
    const fail = (error: unknown) => {
      if (settled) return;
      cleanup();
      reject(error);
    };
    const giveUp = (kind: "stall" | "ceiling", message: string) => {
      if (settled) return;
      cleanup();
      xhr.abort();
      reject(new PartTransferError(kind, message, bytesSent));
    };
    const armStallTimer = () => {
      clearTimeout(stallTimer);
      const window = bodySent ? stallMs * RESPONSE_WAIT_STALL_WINDOWS : stallMs;
      stallTimer = setTimeout(onStall, window);
    };
    function onStall() {
      if (settled) return;
      // A hidden mobile tab can be frozen; its silence is not a dead socket.
      // The ceiling still bounds the attempt.
      if (pageIsHidden()) {
        armStallTimer();
        return;
      }
      giveUp("stall", `Upload stalled: no data moved for ${Math.round(stallMs / 1000)} seconds.`);
    }
    function onCallerAbort() {
      if (settled) return;
      cleanup();
      xhr.abort();
      reject(abortReason(signal!));
    }

    signal?.addEventListener("abort", onCallerAbort, { once: true });
    xhr.open("PUT", url);
    for (const [name, value] of Object.entries(headers ?? {})) xhr.setRequestHeader(name, value);

    xhr.upload.onprogress = event => {
      if (settled) return;
      const loaded = Math.min(event.loaded, body.size);
      if (loaded > bytesSent) {
        bytesSent = loaded;
        onBytes?.(bytesSent);
      }
      if (bytesSent >= body.size) bodySent = true;
      armStallTimer();
    };
    xhr.upload.onload = () => {
      if (settled) return;
      bodySent = true;
      if (bytesSent < body.size) {
        bytesSent = body.size;
        onBytes?.(bytesSent);
      }
      armStallTimer();
    };
    // Response bytes arriving are movement too.
    xhr.onprogress = () => { if (!settled) armStallTimer(); };
    xhr.onload = () => {
      if (settled) return;
      cleanup();
      let responseText = "";
      try { responseText = typeof xhr.responseText === "string" ? xhr.responseText : ""; } catch { responseText = ""; }
      const ok = xhr.status >= 200 && xhr.status < 300;
      let json: unknown;
      if (ok && request.parseJson) {
        try {
          json = JSON.parse(responseText);
        } catch {
          reject(new PartTransferError("network", "The upload receipt could not be read.", bytesSent));
          return;
        }
      }
      resolve({ status: xhr.status, etag: xhr.getResponseHeader("etag"), body: responseText, json, observedProgress: true });
    };
    xhr.onerror = () => fail(new PartTransferError("network", "The connection dropped during the upload.", bytesSent));
    xhr.ontimeout = () => fail(new PartTransferError("ceiling", "Upload part took too long.", bytesSent));
    xhr.onabort = () => {
      if (signal?.aborted) fail(abortReason(signal));
      else fail(new PartTransferError("network", "The upload connection was closed.", bytesSent));
    };

    armStallTimer();
    ceilingTimer = setTimeout(() => {
      giveUp("ceiling", `Upload part did not finish within ${Math.round((Date.now() - startedAt) / 60_000)} minutes.`);
    }, ceilingMs);
    xhr.send(body);
  });
}

async function readFetchResponse(response: Response, parseJson: boolean): Promise<PartTransferResponse> {
  const status = response.status ?? (response.ok ? 200 : 0);
  const etag = response.headers?.get?.("etag") ?? null;
  if (response.ok && parseJson) {
    return { status, etag, body: "", json: await response.json(), observedProgress: false };
  }
  const body = response.ok || typeof response.text !== "function" ? "" : await response.text().catch(() => "");
  return { status, etag, body, observedProgress: false };
}

async function sendPartWithFetch(request: PartTransferRequest): Promise<PartTransferResponse> {
  const { url, body, headers, signal, ceilingMs, onBytes } = request;
  try {
    const result = await uploadRequest(url, { method: "PUT", body, headers },
      response => readFetchResponse(response, Boolean(request.parseJson)), signal, ceilingMs);
    if (result.status >= 200 && result.status < 300) onBytes?.(body.size);
    return result;
  } catch (error) {
    if (signal?.aborted) throw error;
    if (error instanceof Error && /timed out/i.test(error.message)) {
      throw new PartTransferError("ceiling", error.message, 0);
    }
    throw new PartTransferError("network", error instanceof Error ? error.message : "The connection dropped during the upload.", 0);
  }
}
