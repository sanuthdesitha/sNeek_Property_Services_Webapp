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
  signal?: AbortSignal
): Promise<{ url: string; key: string }> {
  const parts = Math.ceil(blob.size / PART_SIZE);

  // Initiate
  const initRes = await fetch("/api/uploads/presign-multipart", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ filename, contentType, partsCount: parts }),
    signal,
  });
  if (!initRes.ok) throw new Error(`presign-multipart failed: ${initRes.status}`);
  const init: MultipartUploadInit = await initRes.json();

  // Upload parts (3 concurrent)
  const concurrency = 3;
  const partETags: { PartNumber: number; ETag: string }[] = new Array(parts);
  let bytesUploaded = 0;
  let partsCompleted = 0;

  async function uploadPart(index: number) {
    const start = index * PART_SIZE;
    const end = Math.min(start + PART_SIZE, blob.size);
    const slice = blob.slice(start, end);
    const res = await fetch(init.partUrls[index], { method: "PUT", body: slice, signal });
    if (!res.ok) throw new Error(`part ${index + 1} upload failed: ${res.status}`);
    const etag = res.headers.get("etag")?.replaceAll('"', "") ?? "";
    partETags[index] = { PartNumber: index + 1, ETag: etag };
    bytesUploaded += slice.size;
    partsCompleted++;
    onProgress?.({ bytesUploaded, totalBytes: blob.size, partsCompleted, partsTotal: parts });
  }

  // Run in batches of `concurrency`
  for (let i = 0; i < parts; i += concurrency) {
    const batch: Promise<void>[] = [];
    for (let j = 0; j < concurrency && i + j < parts; j++) {
      batch.push(uploadPart(i + j));
    }
    await Promise.all(batch);
  }

  // Complete
  const completeRes = await fetch("/api/uploads/complete-multipart", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ uploadId: init.uploadId, key: init.key, parts: partETags }),
    signal,
  });
  if (!completeRes.ok) throw new Error(`complete-multipart failed: ${completeRes.status}`);
  return completeRes.json();
}
