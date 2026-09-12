export interface MultipartUploadInit {
  uploadId: string;
  key: string;
  partUrls: string[]; // pre-signed URLs for each part
}

export interface UploadProgress {
  bytesUploaded: number;
  totalBytes: number;
  partsCompleted: number;
  partsTotal: number;
}

const PART_SIZE = 5 * 1024 * 1024; // 5 MB

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
  onAllocated?: (allocation: { key: string; uploadId: string }) => Promise<void>
): Promise<{ url: string; key: string }> {
  if (!blob.size) throw new Error("Cannot upload an empty file.");
  signal?.throwIfAborted();
  const partSize = Math.max(PART_SIZE, Math.ceil(blob.size / 10_000));
  const parts = Math.ceil(blob.size / partSize);

  // Initiate
  const initRes = await fetch("/api/uploads/presign-multipart", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ filename, contentType, partsCount: parts, ...(folder ? { folder } : {}) }),
    signal,
  });
  if (!initRes.ok) {
    const error = await initRes.json().catch(() => ({}));
    throw new Error(error.error || `Could not start upload (${initRes.status})`);
  }
  const init: MultipartUploadInit = await initRes.json();
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

  async function proxyPart(index: number, slice: Blob): Promise<Response> {
    const query = new URLSearchParams({ key: init.key, uploadId: init.uploadId, partNumber: String(index + 1) });
    const response = await fetch(`/api/uploads/part?${query}`, {
      method: "PUT", body: slice, signal,
      headers: { "x-upload-size": String(slice.size) },
    });
    if (!response.ok) return response;
    const body = await response.json();
    return new Response(null, { headers: { etag: body.etag ?? "" } });
  }

  async function uploadPart(index: number) {
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
            res = await fetch(init.partUrls[index], { method: "PUT", body: slice, signal });
          } catch (error) {
            signal?.throwIfAborted();
            useProxy = true;
            res = await proxyPart(index, slice);
          }
          if (res.ok && !res.headers.get("etag")) {
            useProxy = true;
            res = await proxyPart(index, slice);
          }
        }
        if (res.ok || (res.status < 500 && res.status !== 429)) break;
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

  try {
    // A rejected durable write stops all transfer. The catch below aborts this
    // empty multipart allocation using its own cleanup request.
    await onAllocated?.({ key: init.key, uploadId: init.uploadId });
    signal?.throwIfAborted();
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

    const completeRes = await fetch("/api/uploads/complete-multipart", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ uploadId: init.uploadId, key: init.key, parts: partETags }),
      signal,
    });
    if (!completeRes.ok) {
      const error = await completeRes.json().catch(() => ({}));
      throw new Error(error.error || `Could not finish upload (${completeRes.status})`);
    }
    return completeRes.json();
  } catch (error) {
    // Cleanup must use its own request: the user's signal may already be aborted.
    await fetch("/api/uploads/abort-multipart", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ uploadId: init.uploadId, key: init.key }),
      signal: AbortSignal.timeout(10_000),
    }).catch(() => {});
    throw error;
  }
}
