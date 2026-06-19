"use client";

import * as React from "react";
import { Upload, AlertCircle } from "lucide-react";
import { compressImage, prepareUploadFile } from "@/lib/uploads/compress";
import type { StampOptions } from "@/lib/uploads/stamp";
import { uploadMultipart } from "@/lib/uploads/multipart-client";
import { cn } from "@/lib/utils";

const MULTIPART_THRESHOLD = 10 * 1024 * 1024;
const MAX_RETRIES = 3;

export interface UploadResult {
  url: string;
  key: string;
  filename: string;
  size: number;
  mime: string;
}

export interface UploadDropzoneProps {
  onUploaded: (result: UploadResult) => void;
  onFailure?: (filename: string, reason: string) => void;
  jobId?: string;
  accept?: string;
  maxFiles?: number;
  className?: string;
  /**
   * Evidence stamping. When stamp options are supplied (a job/QA/maintenance
   * context), every stampable image is burned with the evidence overlay BEFORE
   * compression + upload. Leave undefined for non-evidence uploads (marketing
   * assets, report logos, avatars) — those are compressed but never stamped.
   */
  stamp?: StampOptions;
}

interface FileState {
  file: File;
  status: "queued" | "compressing" | "uploading" | "done" | "failed";
  progress: number;
  attempt: number;
  error?: string;
}

async function uploadSinglePut(
  blob: Blob,
  filename: string,
  contentType: string
): Promise<{ url: string; key: string }> {
  // Upload through our own server (/api/uploads/direct) rather than presigning a
  // URL and PUTting straight to the bucket. The direct-to-bucket PUT requires a
  // bucket CORS policy allowing browser uploads; without it the browser throws
  // "Failed to fetch". Routing through the same-origin API avoids CORS entirely.
  const form = new FormData();
  form.append("file", new File([blob], filename, { type: contentType || "application/octet-stream" }));
  const res = await fetch("/api/uploads/direct", { method: "POST", body: form });
  if (!res.ok) {
    let message = `upload failed: ${res.status}`;
    try {
      const body = await res.json();
      if (body?.error) message = body.error;
    } catch {
      /* keep status message */
    }
    throw new Error(message);
  }
  const data = (await res.json()) as { key: string; url?: string };
  return { url: data.url ?? data.key, key: data.key };
}

async function recordFailure(
  filename: string,
  size: number,
  mime: string,
  reason: string,
  message: string,
  jobId?: string
) {
  try {
    await fetch("/api/admin/system/uploads/log-failure", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ filename, size, mime, reason, message, jobId }),
    });
  } catch {
    // best-effort
  }
}

export function UploadDropzone({
  onUploaded,
  onFailure,
  jobId,
  accept,
  maxFiles = 10,
  className,
  stamp,
}: UploadDropzoneProps) {
  const [files, setFiles] = React.useState<FileState[]>([]);
  const [dragOver, setDragOver] = React.useState(false);
  const inputRef = React.useRef<HTMLInputElement>(null);
  const cameraInputRef = React.useRef<HTMLInputElement>(null);

  // Offer an in-app camera capture only for evidence (stamped) image contexts.
  const allowCamera = Boolean(stamp) && (!accept || /image/i.test(accept));

  const processFile = React.useCallback(
    async (idx: number, file: File, shouldStamp: boolean) => {
      setFiles((prev) => prev.map((f, i) => (i === idx ? { ...f, status: "compressing" } : f)));

      let blob: Blob = file;
      let uploadName = file.name;
      let uploadType = file.type;
      if (shouldStamp && stamp) {
        // Camera capture in an evidence context: burn the timestamp/evidence
        // stamp (then compress), in one helper.
        try {
          const prepared = await prepareUploadFile(file, stamp);
          blob = prepared;
          uploadName = prepared.name;
          uploadType = prepared.type || file.type;
        } catch {
          // prepare failed; upload original
        }
      } else {
        // Gallery upload / drag-drop (or non-evidence): NEVER stamp — an uploaded
        // photo already carries its own timestamp, so a second one would conflict.
        // Just compress.
        try {
          const cr = await compressImage(file);
          blob = cr.blob;
        } catch {
          // compression failed; upload original
        }
      }

      const useMultipart = blob.size > MULTIPART_THRESHOLD;

      for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        try {
          setFiles((prev) =>
            prev.map((f, i) =>
              i === idx ? { ...f, status: "uploading", attempt, progress: 0 } : f
            )
          );
          let result: { url: string; key: string };
          if (useMultipart) {
            result = await uploadMultipart(blob, uploadName, uploadType, (p) => {
              setFiles((prev) =>
                prev.map((f, i) =>
                  i === idx ? { ...f, progress: (p.bytesUploaded / p.totalBytes) * 100 } : f
                )
              );
            });
          } else {
            result = await uploadSinglePut(blob, uploadName, uploadType);
            setFiles((prev) => prev.map((f, i) => (i === idx ? { ...f, progress: 100 } : f)));
          }
          setFiles((prev) =>
            prev.map((f, i) => (i === idx ? { ...f, status: "done", progress: 100 } : f))
          );
          onUploaded({ ...result, filename: uploadName, size: blob.size, mime: uploadType });
          return;
        } catch (err) {
          if (attempt >= MAX_RETRIES) {
            const reason = err instanceof Error ? err.message : "UPLOAD_FAILED";
            setFiles((prev) =>
              prev.map((f, i) => (i === idx ? { ...f, status: "failed", error: reason } : f))
            );
            onFailure?.(file.name, reason);
            await recordFailure(file.name, file.size, file.type, "UPLOAD_FAILED", reason, jobId);
            return;
          }
          // Exponential backoff: 1s, 2s, 4s
          await new Promise((r) => setTimeout(r, 2 ** (attempt - 1) * 1000));
        }
      }
    },
    [onUploaded, onFailure, jobId, stamp]
  );

  const handleFiles = (incoming: File[], source: "camera" | "gallery") => {
    const accepted = incoming.slice(0, maxFiles);
    const start = files.length;
    // Only stamp genuine in-app camera captures; uploads keep their own timestamp.
    const shouldStamp = Boolean(stamp) && source === "camera";
    setFiles((prev) => [
      ...prev,
      ...accepted.map<FileState>((file) => ({ file, status: "queued", progress: 0, attempt: 0 })),
    ]);
    accepted.forEach((file, i) => processFile(start + i, file, shouldStamp));
  };

  return (
    <div className={cn("space-y-2", className)}>
      <div
        role="button"
        tabIndex={0}
        className={cn(
          "flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-border bg-surface-raised/40 p-8 transition-colors",
          dragOver && "border-primary bg-primary-soft"
        )}
        onClick={() => inputRef.current?.click()}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            inputRef.current?.click();
          }
        }}
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          handleFiles(Array.from(e.dataTransfer.files), "gallery");
        }}
      >
        <Upload className="size-5 text-muted-foreground" />
        <p className="text-sm text-muted-foreground">Drag files here, or click to choose.</p>
        {allowCamera && (
          <p className="text-xs text-muted-foreground/80">Uploaded photos keep their own timestamp.</p>
        )}
      </div>
      {allowCamera && (
        <button
          type="button"
          onClick={() => cameraInputRef.current?.click()}
          className="flex w-full items-center justify-center gap-2 rounded-lg border border-primary/40 bg-primary-soft/60 px-4 py-2.5 text-sm font-medium text-primary transition-colors hover:bg-primary-soft"
        >
          📷 Take photo (adds evidence timestamp)
        </button>
      )}
      <input
        ref={inputRef}
        type="file"
        multiple
        accept={accept}
        className="sr-only"
        onChange={(e) => e.target.files && handleFiles(Array.from(e.target.files), "gallery")}
      />
      {allowCamera && (
        <input
          ref={cameraInputRef}
          type="file"
          accept="image/*"
          capture="environment"
          className="sr-only"
          onChange={(e) => e.target.files && handleFiles(Array.from(e.target.files), "camera")}
        />
      )}
      {files.length > 0 && (
        <ul className="space-y-1">
          {files.map((f, i) => (
            <li
              key={i}
              className="flex items-center gap-2 rounded border border-border bg-surface px-3 py-2 text-sm"
            >
              <span className="flex-1 truncate">{f.file.name}</span>
              <span className="text-xs text-muted-foreground">
                {(f.file.size / 1024).toFixed(0)} KB
              </span>
              {f.status === "done" && <span className="text-success">✓</span>}
              {f.status === "failed" && (
                <span
                  className="flex items-center gap-1 text-destructive"
                  title={f.error ?? "Upload failed"}
                >
                  <AlertCircle className="size-3" />
                  {f.error ? `Failed: ${f.error}` : "Failed"}
                </span>
              )}
              {(f.status === "uploading" || f.status === "compressing") && (
                <span className="text-xs text-muted-foreground">{f.progress.toFixed(0)}%</span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
