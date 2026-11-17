import { uploadRequest } from "./request";
import { PartTransferError, sendPart, type PartTransferResponse } from "./part-transport";

export interface MultipartUploadInit {
  uploadId: string;
  key: string;
  partUrls: string[]; // pre-signed URLs for each part
  uploadedParts?: { PartNumber: number; ETag: string; Size: number }[];
}

export interface UploadProgress {
  bytesUploaded: number;
  totalBytes: number;
  partsCompleted: number;
  partsTotal: number;
}

/** Why the last part attempt of a failed upload did not succeed. */
export type UploadFailureMode = "stalled" | "refused" | "network" | "offline" | "receipt" | "setup";

/**
 * Diagnostic summary of one multipart transfer. Contains no URLs, keys or
 * signatures, so it is safe to attach to upload-failure telemetry.
 */
export interface UploadTransferStats {
  /** Measured throughput while parts were moving, or null before any bytes moved. */
  bytesPerSecond: number | null;
  partsCompleted: number;
  partsTotal: number;
  /** Route the most recent part attempt used. */
  route: "direct" | "proxy";
  /** Parallel parts in use when the upload settled. */
  concurrency: number;
  stalls: number;
  failureMode: UploadFailureMode | null;
  /** HTTP status of the last refused attempt, when there was one. */
  lastStatus: number | null;
}

export type ConnectionAdvice = "slow" | "offline";

export interface MultipartTransferOptions {
  /** Plain-language connection advice for the person waiting. Fires at most once per kind. */
  onConnectionAdvice?: (advice: ConnectionAdvice) => void;
  /** Called with diagnostics when an upload fails for any reason other than cancellation. */
  onFailureStats?: (stats: UploadTransferStats) => void;
}

const PART_SIZE = 5 * 1024 * 1024; // 5 MB, the storage minimum; cannot shrink.

/**
 * A part fails only when no bytes move for this long. Mobile handovers and
 * brief signal loss pause transfers for tens of seconds; a dead socket is
 * still released in about a minute.
 */
export const PART_STALL_MS = 60_000;
/** Absolute bound per part attempt: 5 MB at about 5.7 KB/s still completes. */
export const PART_CEILING_MS = 15 * 60_000;
/** Attempts per part, with this backoff between them. Offline waits do not count. */
export const PART_ATTEMPTS = 5;
export const PART_BACKOFF_MS = [1_000, 2_000, 4_000, 8_000] as const;
/** How long to wait for the browser to report it is back online before failing. */
export const OFFLINE_WAIT_MS = 5 * 60_000;
/**
 * Concurrency after the first part is measured on its own.
 * - at least 256 KB/s (about 2 Mbps): 3 parts at once
 * - at least 96 KB/s (about 0.8 Mbps): 2 parts at once
 * - slower: 1 part at a time, so each part keeps the whole uplink and is
 *   exposed to a dropout for the shortest time.
 * Any stall drops the rest of the upload to 1 part at a time.
 */
export const CONCURRENCY_THREE_BYTES_PER_SECOND = 256 * 1024;
export const CONCURRENCY_TWO_BYTES_PER_SECOND = 96 * 1024;
/** Below about 0.4 Mbps a long video takes many minutes; say so in plain words. */
export const SLOW_CONNECTION_BYTES_PER_SECOND = 48 * 1024;
/** A flapping connection may skip the attempt count this many times per part. */
const MAX_OFFLINE_FAILURES_PER_PART = 20;
/** Signed part URLs last an hour; refresh them at most this often on a 403. */
const URL_REFRESH_MIN_INTERVAL_MS = 5 * 60_000;

export function chooseConcurrency(bytesPerSecond: number | null): number {
  if (bytesPerSecond === null) return 1;
  if (bytesPerSecond >= CONCURRENCY_THREE_BYTES_PER_SECOND) return 3;
  if (bytesPerSecond >= CONCURRENCY_TWO_BYTES_PER_SECOND) return 2;
  return 1;
}

// Control requests are bounded too; setup/completion must never hold the
// capture lock forever. Never blindly retry allocating or completing an upload.
function jsonRequest(url: string, options: RequestInit, signal?: AbortSignal) {
  return uploadRequest(url, options, async response => {
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error || `Upload request failed (${response.status})`);
    return body;
  }, signal);
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) { reject(signal.reason); return; }
    const timer = setTimeout(() => { signal?.removeEventListener("abort", onAbort); resolve(); }, ms);
    function onAbort() { clearTimeout(timer); reject(signal!.reason); }
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

function browserIsOffline(): boolean {
  return typeof navigator !== "undefined" && navigator.onLine === false;
}

class OfflineUploadError extends Error {}

/** Wait (bounded, cancellable) for the browser to report it is back online. */
function waitForOnline(signal: AbortSignal | undefined, timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) { reject(signal.reason); return; }
    if (!browserIsOffline() || typeof window === "undefined") { resolve(); return; }
    const finish = (error?: unknown) => {
      clearTimeout(timer);
      window.removeEventListener("online", onOnline);
      signal?.removeEventListener("abort", onAbort);
      if (error === undefined) resolve(); else reject(error);
    };
    const onOnline = () => finish();
    const onAbort = () => finish(signal!.reason);
    const timer = setTimeout(() => finish(new OfflineUploadError(
      "This phone has been offline for too long. Retry the saved upload when connected."
    )), timeoutMs);
    window.addEventListener("online", onOnline);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

/** Storage closes idle or short sockets with HTTP 400; those are worth retrying. */
function isTransientStorageRejection(response: PartTransferResponse): boolean {
  return response.status === 400 && /RequestTimeout|IncompleteBody/.test(response.body);
}

function isRetryableStatus(response: PartTransferResponse): boolean {
  return response.status >= 500 || response.status === 408 || response.status === 429 || isTransientStorageRejection(response);
}

/** Tracks bytes moving on the wire and the time any part was in flight. */
class ThroughputMeter {
  private movedBytes = 0;
  private activeMs = 0;
  private activeSince: number | null = null;
  private inFlight = 0;

  begin() {
    if (this.inFlight++ === 0) this.activeSince = Date.now();
  }
  end() {
    if (--this.inFlight === 0 && this.activeSince !== null) {
      this.activeMs += Date.now() - this.activeSince;
      this.activeSince = null;
    }
  }
  moved(bytes: number) {
    this.movedBytes += bytes;
  }
  bytesPerSecond(): number | null {
    const elapsed = this.activeMs + (this.activeSince !== null ? Date.now() - this.activeSince : 0);
    if (this.movedBytes <= 0 || elapsed <= 0) return null;
    return Math.round(this.movedBytes / (elapsed / 1000));
  }
  elapsedMs(): number {
    return this.activeMs + (this.activeSince !== null ? Date.now() - this.activeSince : 0);
  }
}

export async function uploadMultipart(
  blob: Blob,
  filename: string,
  contentType: string,
  onProgress?: (p: UploadProgress) => void,
  signal?: AbortSignal,
  /**
   * Where the file belongs. Was never sent, so every large upload landed in
   * the default `uploads/` prefix while its small siblings went to the right
   * folder — the same job's photos and its walkthrough video ended up in two
   * different places.
   */
  folder?: string,
  /** Durable callers must commit this identity before the first byte is sent. */
  onAllocated?: (allocation: { key: string; uploadId: string }) => Promise<void>,
  resume?: { key: string; uploadId: string },
  options: MultipartTransferOptions = {}
): Promise<{ url: string; key: string }> {
  if (!blob.size) throw new Error("Cannot upload an empty file.");
  signal?.throwIfAborted();
  const partSize = Math.max(PART_SIZE, Math.ceil(blob.size / 10_000));
  const parts = Math.ceil(blob.size / partSize);

  const stats: UploadTransferStats = {
    bytesPerSecond: null, partsCompleted: 0, partsTotal: parts, route: "direct",
    concurrency: 1, stalls: 0, failureMode: null, lastStatus: null,
  };
  const reportFailure = () => {
    if (signal?.aborted) return;
    try { options.onFailureStats?.({ ...stats }); } catch { /* Diagnostics never change the outcome. */ }
  };

  // Initiate
  let response: any;
  try {
    response = await jsonRequest(resume ? "/api/uploads/resume-multipart" : "/api/uploads/presign-multipart", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(resume ? { ...resume, size: blob.size, partSize, contentType } : { filename, contentType, partsCount: parts, ...(folder ? { folder } : {}) }),
    }, signal);
  } catch (error) {
    stats.failureMode = "setup";
    reportFailure();
    throw error;
  }
  if (resume && response.key !== resume.key) throw new Error("Upload recovery returned a different file. No bytes were sent.");
  if (resume && response.completed === true) {
    if (typeof response.url !== "string" || !response.url) throw new Error("Completed upload receipt is missing.");
    onProgress?.({ bytesUploaded: blob.size, totalBytes: blob.size, partsCompleted: parts, partsTotal: parts });
    return { key: response.key, url: response.url };
  }
  const init: MultipartUploadInit = response;
  if (typeof init.key !== "string" || !init.key.trim() || typeof init.uploadId !== "string" || !init.uploadId.trim() ||
    !Array.isArray(init.partUrls) || init.partUrls.length !== parts || init.partUrls.some(url => typeof url !== "string" || !url.trim())) {
    throw new Error("Storage returned an invalid upload allocation. No file bytes were sent.");
  }

  const partETags: { PartNumber: number; ETag: string }[] = new Array(parts);
  let confirmedBytes = 0;
  let partsCompleted = 0;
  let useProxy = false;
  for (const part of init.uploadedParts ?? []) {
    const expectedSize = Math.min(partSize, blob.size - (part.PartNumber - 1) * partSize);
    if (!Number.isInteger(part.PartNumber) || part.PartNumber < 1 || part.PartNumber > parts || !part.ETag || part.Size !== expectedSize || partETags[part.PartNumber - 1]) {
      throw new Error("Storage returned invalid saved video parts. No bytes were sent.");
    }
    partETags[part.PartNumber - 1] = { PartNumber: part.PartNumber, ETag: part.ETag.replaceAll('"', "") };
    confirmedBytes += part.Size;
    partsCompleted++;
  }
  stats.partsCompleted = partsCompleted;

  // Live byte progress: confirmed parts plus bytes of attempts in flight. A
  // failed attempt's bytes are removed, and the reported value never moves
  // backwards, so a retry neither double counts nor makes the bar jump back.
  const inFlightBytes = new Map<number, number>();
  let reportedBytes = 0;
  const publishProgress = () => {
    let moving = 0;
    inFlightBytes.forEach(bytes => { moving += bytes; });
    const actual = Math.min(blob.size, confirmedBytes + moving);
    reportedBytes = Math.max(reportedBytes, actual);
    onProgress?.({ bytesUploaded: reportedBytes, totalBytes: blob.size, partsCompleted, partsTotal: parts });
  };

  const meter = new ThroughputMeter();
  let concurrency = 1;
  let stalled = false;
  const advised = new Set<ConnectionAdvice>();
  const advise = (advice: ConnectionAdvice) => {
    if (advised.has(advice)) return;
    advised.add(advice);
    try { options.onConnectionAdvice?.(advice); } catch { /* Advice is best effort. */ }
  };
  const checkSlowConnection = () => {
    const speed = meter.bytesPerSecond();
    stats.bytesPerSecond = speed;
    // Judge only after enough movement to be meaningful.
    if (speed !== null && speed < SLOW_CONNECTION_BYTES_PER_SECOND && meter.elapsedMs() >= 15_000) advise("slow");
  };

  // Signed URLs expire after an hour; a long slow upload refreshes them through
  // the existing owned-allocation recovery route instead of abandoning the bucket.
  let partUrls = init.partUrls;
  let lastRefreshAt = Date.now();
  let refreshing: Promise<boolean> | null = null;
  const refreshPartUrls = (): Promise<boolean> => {
    if (refreshing) return refreshing;
    if (Date.now() - lastRefreshAt < URL_REFRESH_MIN_INTERVAL_MS) return Promise.resolve(false);
    refreshing = (async () => {
      try {
        const fresh = await jsonRequest("/api/uploads/resume-multipart", {
          method: "POST", headers: { "content-type": "application/json" },
          body: JSON.stringify({ key: init.key, uploadId: init.uploadId, size: blob.size, partSize, contentType }),
        }, signal);
        // Only the same live allocation may be continued. Anything else keeps
        // the authenticated proxy fallback; recovery stays with explicit Retry.
        if (fresh?.key !== init.key || fresh?.uploadId !== init.uploadId || !Array.isArray(fresh.partUrls) ||
          fresh.partUrls.length !== parts || fresh.partUrls.some((url: unknown) => typeof url !== "string" || !url)) return false;
        partUrls = fresh.partUrls;
        return true;
      } catch {
        signal?.throwIfAborted();
        return false;
      } finally {
        lastRefreshAt = Date.now();
        refreshing = null;
      }
    })();
    return refreshing;
  };

  async function transfer(index: number, slice: Blob, route: "direct" | "proxy"): Promise<PartTransferResponse> {
    stats.route = route;
    let attemptBytes = 0;
    inFlightBytes.set(index, 0);
    meter.begin();
    try {
      const request = route === "direct"
        ? { url: partUrls[index] }
        : {
            url: `/api/uploads/part?${new URLSearchParams({ key: init.key, uploadId: init.uploadId, partNumber: String(index + 1) })}`,
            headers: { "x-upload-size": String(slice.size) },
            parseJson: true,
          };
      return await sendPart({
        ...request, body: slice, signal, stallMs: PART_STALL_MS, ceilingMs: PART_CEILING_MS,
        onBytes: loaded => {
          if (loaded > attemptBytes) meter.moved(loaded - attemptBytes);
          attemptBytes = loaded;
          inFlightBytes.set(index, loaded);
          publishProgress();
          checkSlowConnection();
        },
      });
    } finally {
      meter.end();
      // Removed whatever the outcome: success moves them into confirmed bytes.
      inFlightBytes.delete(index);
    }
  }

  /** One attempt; proxy only for refusals the proxy was built for. */
  async function attemptPart(index: number, slice: Blob): Promise<PartTransferResponse> {
    if (useProxy) return proxyAttempt(index, slice);
    let result: PartTransferResponse;
    try {
      result = await transfer(index, slice, "direct");
    } catch (error) {
      signal?.throwIfAborted();
      // An immediate failure with no bytes sent while online looks like a CORS
      // or blocked-host refusal: stream through the application instead. A
      // stall, a timeout or a drop after bytes moved is retried on this route.
      if (error instanceof PartTransferError && error.kind === "network" && error.bytesSent === 0 && !browserIsOffline()) {
        useProxy = true;
        return proxyAttempt(index, slice);
      }
      throw error;
    }
    if (result.status === 403 && await refreshPartUrls()) {
      result = await transfer(index, slice, "direct");
    }
    if (result.status === 403 || (result.status >= 200 && result.status < 300 && !result.etag)) {
      useProxy = true;
      return proxyAttempt(index, slice);
    }
    return result;
  }

  async function proxyAttempt(index: number, slice: Blob): Promise<PartTransferResponse> {
    const result = await transfer(index, slice, "proxy");
    if (result.status >= 200 && result.status < 300) {
      const receipt = result.json as { etag?: unknown } | undefined;
      return { ...result, etag: typeof receipt?.etag === "string" ? receipt.etag : "" };
    }
    return result;
  }

  async function uploadPart(index: number): Promise<number | null> {
    if (partETags[index]) return null;
    const start = index * partSize;
    const end = Math.min(start + partSize, blob.size);
    const slice = blob.slice(start, end);
    let res: PartTransferResponse | undefined;
    let lastError: unknown;
    let attempt = 0;
    let offlineFailures = 0;
    let attemptStartedAt = Date.now();
    while (attempt < PART_ATTEMPTS) {
      signal?.throwIfAborted();
      if (browserIsOffline()) {
        advise("offline");
        try {
          await waitForOnline(signal, OFFLINE_WAIT_MS);
        } catch (error) {
          if (error instanceof OfflineUploadError) stats.failureMode = "offline";
          throw error;
        }
      }
      attemptStartedAt = Date.now();
      lastError = undefined;
      try {
        res = await attemptPart(index, slice);
        if (res.status >= 200 && res.status < 300) break;
        stats.lastStatus = res.status;
        stats.failureMode = "refused";
        if (!isRetryableStatus(res)) break;
      } catch (error) {
        signal?.throwIfAborted();
        lastError = error;
        res = undefined;
        if (error instanceof PartTransferError && (error.kind === "stall" || error.kind === "ceiling")) {
          stats.stalls++;
          stats.failureMode = "stalled";
          stalled = true;
          concurrency = 1;
          advise("slow");
        } else {
          stats.failureMode = "network";
        }
        // A dropout reported by the browser waits for the connection instead
        // of spending an attempt.
        if (browserIsOffline() && ++offlineFailures <= MAX_OFFLINE_FAILURES_PER_PART) continue;
      }
      attempt++;
      if (attempt < PART_ATTEMPTS) await sleep(PART_BACKOFF_MS[Math.min(attempt - 1, PART_BACKOFF_MS.length - 1)], signal);
    }
    if (lastError !== undefined && !res) throw lastError;
    if (!res || res.status < 200 || res.status >= 300) {
      throw new Error(`Part ${index + 1} upload failed (${res?.status ?? "network error"}). Please retry.`);
    }
    const etag = res.etag?.replaceAll('"', "") ?? "";
    if (!etag) {
      stats.failureMode = "receipt";
      throw new Error("Storage did not return an upload receipt. Its CORS settings must expose the ETag header.");
    }
    partETags[index] = { PartNumber: index + 1, ETag: etag };
    confirmedBytes += slice.size;
    partsCompleted++;
    stats.partsCompleted = partsCompleted;
    stats.failureMode = null;
    stats.lastStatus = null;
    publishProgress();
    const elapsed = Date.now() - attemptStartedAt;
    return elapsed > 0 ? Math.round(slice.size / (elapsed / 1000)) : null;
  }

  /**
   * The first outstanding part goes alone so its speed can be measured; the
   * rest run with a concurrency chosen from that speed. On the first failure
   * nothing new starts, parts already moving settle, and the first error wins.
   */
  async function uploadOutstandingParts(): Promise<void> {
    const pending: number[] = [];
    for (let index = 0; index < parts; index++) if (!partETags[index]) pending.push(index);
    const probe = pending.shift();
    if (probe === undefined) return;
    const probeSpeed = await uploadPart(probe);
    if (!stalled) concurrency = chooseConcurrency(probeSpeed ?? meter.bytesPerSecond());
    stats.concurrency = concurrency;
    await new Promise<void>((resolve, reject) => {
      let active = 0;
      let failure: { error: unknown } | null = null;
      const launch = () => {
        if (failure) {
          if (active === 0) reject(failure.error);
          return;
        }
        if (pending.length === 0 && active === 0) { resolve(); return; }
        while (pending.length > 0 && active < concurrency) {
          const index = pending.shift()!;
          active++;
          uploadPart(index).then(
            () => { active--; launch(); },
            error => { active--; failure ??= { error }; launch(); },
          );
        }
        stats.concurrency = concurrency;
      };
      launch();
    });
  }

  let allocationRetained = false;
  try {
    // A rejected durable write stops all transfer. The catch below aborts this
    // empty multipart allocation using its own cleanup request.
    await onAllocated?.({ key: init.key, uploadId: init.uploadId });
    allocationRetained = Boolean(onAllocated);
    signal?.throwIfAborted();
    publishProgress();
    try {
      await uploadOutstandingParts();
    } finally {
      stats.bytesPerSecond = meter.bytesPerSecond();
      stats.concurrency = concurrency;
    }

    let completed: any;
    try {
      completed = await jsonRequest("/api/uploads/complete-multipart", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ uploadId: init.uploadId, key: init.key, parts: partETags }),
      }, signal);
    } catch (error) {
      stats.failureMode = "setup";
      throw error;
    }
    if (completed.key !== init.key || typeof completed.url !== "string" || !completed.url.trim()) {
      stats.failureMode = "receipt";
      throw new Error("Storage returned an invalid completion receipt. Retry the saved upload to verify it.");
    }
    return { key: completed.key as string, url: completed.url as string };
  } catch (error) {
    reportFailure();
    // Durable evidence keeps its allocation and acknowledged parts for Retry.
    // Clean up only new allocations without recovery metadata. A resumed
    // allocation already has saved identity/parts even if this save failed.
    if (!allocationRetained && !resume) await fetch("/api/uploads/abort-multipart", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ uploadId: init.uploadId, key: init.key }),
      signal: AbortSignal.timeout(10_000),
    }).catch(() => {});
    throw error;
  }
}
