import { uploadRequest } from "./request";

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

const PART_SIZE = 5 * 1024 * 1024; // 5 MB

// Control requests are bounded too; setup/completion must never hold the
// capture lock forever. Never blindly retry allocating or completing an upload.
function jsonRequest(url: string, options: RequestInit, signal?: AbortSignal) {
  return uploadRequest(url, options, async response => {
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error || `Upload request failed (${response.status})`);
    return body;
  }, signal);
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
  resume?: { key: string; uploadId: string }
): Promise<{ url: string; key: string }> {
  if (!blob.size) throw new Error("Cannot upload an empty file.");
  signal?.throwIfAborted();
  const partSize = Math.max(PART_SIZE, Math.ceil(blob.size / 10_000));
  const parts = Math.ceil(blob.size / partSize);

  // Initiate
  const response = await jsonRequest(resume ? "/api/uploads/resume-multipart" : "/api/uploads/presign-multipart", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(resume ? { ...resume, size: blob.size, partSize, contentType } : { filename, contentType, partsCount: parts, ...(folder ? { folder } : {}) }),
  }, signal);
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

  // Upload parts (3 concurrent)
  const concurrency = 3;
  const partETags: { PartNumber: number; ETag: string }[] = new Array(parts);
  let bytesUploaded = 0;
  let partsCompleted = 0;
  let useProxy = false;
  for (const part of init.uploadedParts ?? []) {
    const expectedSize = Math.min(partSize, blob.size - (part.PartNumber - 1) * partSize);
    if (!Number.isInteger(part.PartNumber) || part.PartNumber < 1 || part.PartNumber > parts || !part.ETag || part.Size !== expectedSize || partETags[part.PartNumber - 1]) {
      throw new Error("Storage returned invalid saved video parts. No bytes were sent.");
    }
    partETags[part.PartNumber - 1] = { PartNumber: part.PartNumber, ETag: part.ETag.replaceAll('"', "") };
    bytesUploaded += part.Size;
    partsCompleted++;
  }

  async function proxyPart(index: number, slice: Blob): Promise<Response> {
    const query = new URLSearchParams({ key: init.key, uploadId: init.uploadId, partNumber: String(index + 1) });
    return uploadRequest(`/api/uploads/part?${query}`, {
      method: "PUT", body: slice,
      headers: { "x-upload-size": String(slice.size) },
    }, async response => {
      if (!response.ok) return response;
      const body = await response.json();
      return new Response(null, { headers: { etag: body.etag ?? "" } });
    }, signal, 120_000);
  }

  async function uploadPart(index: number) {
    if (partETags[index]) return;
    const start = index * partSize;
    const end = Math.min(start + partSize, blob.size);
    const slice = blob.slice(start, end);
    let res: Response | undefined;
    for (let attempt = 0; attempt < 3; attempt++) {
      signal?.throwIfAborted();
      try {
        if (useProxy) {
          res = await proxyPart(index, slice);
        } else {
          try {
            res = await uploadRequest(init.partUrls[index], { method: "PUT", body: slice }, async response => response, signal, 120_000);
          } catch (error) {
            signal?.throwIfAborted();
            useProxy = true;
            res = await proxyPart(index, slice);
          }
          if ((res.ok && !res.headers.get("etag")) || res.status === 403) {
            useProxy = true;
            res = await proxyPart(index, slice);
          }
        }
        if (res.ok || (res.status < 500 && res.status !== 408 && res.status !== 429)) break;
      } catch (error) {
        if (signal?.aborted || attempt === 2) throw error;
      }
      if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, 500 * (attempt + 1)));
    }
    if (!res?.ok) throw new Error(`Part ${index + 1} upload failed (${res?.status ?? "network error"}). Please retry.`);
    const etag = res.headers.get("etag")?.replaceAll('"', "") ?? "";
    if (!etag) throw new Error("Storage did not return an upload receipt. Its CORS settings must expose the ETag header.");
    partETags[index] = { PartNumber: index + 1, ETag: etag };
    bytesUploaded += slice.size;
    partsCompleted++;
    onProgress?.({ bytesUploaded, totalBytes: blob.size, partsCompleted, partsTotal: parts });
  }

  let allocationRetained = false;
  try {
    // A rejected durable write stops all transfer. The catch below aborts this
    // empty multipart allocation using its own cleanup request.
    await onAllocated?.({ key: init.key, uploadId: init.uploadId });
    allocationRetained = Boolean(onAllocated);
    signal?.throwIfAborted();
    onProgress?.({ bytesUploaded, totalBytes: blob.size, partsCompleted, partsTotal: parts });
    // Run in batches of `concurrency`.
    for (let i = 0; i < parts; i += concurrency) {
      const batch: Promise<void>[] = [];
      for (let j = 0; j < concurrency && i + j < parts; j++) {
        batch.push(uploadPart(i + j));
      }
      const results = await Promise.allSettled(batch);
      const failed = results.find((result): result is PromiseRejectedResult => result.status === "rejected");
      if (failed) throw failed.reason;
    }

    const completed = await jsonRequest("/api/uploads/complete-multipart", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ uploadId: init.uploadId, key: init.key, parts: partETags }),
    }, signal);
    if (completed.key !== init.key || typeof completed.url !== "string" || !completed.url.trim()) {
      throw new Error("Storage returned an invalid completion receipt. Retry the saved upload to verify it.");
    }
    return { key: completed.key as string, url: completed.url as string };
  } catch (error) {
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
