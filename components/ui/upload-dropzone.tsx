"use client";

import * as React from "react";
import { Upload, AlertCircle } from "lucide-react";
import { compressImage } from "@/lib/uploads/compress";
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
  const presignRes = await fetch("/api/uploads/presign", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ filename, contentType }),
  });
  if (!presignRes.ok) throw new Error(`presign failed: ${presignRes.status}`);
  const { uploadUrl, key } = await presignRes.json();
  const putRes = await fetch(uploadUrl, {
    method: "PUT",
    body: blob,
    headers: { "content-type": contentType },
  });
  if (!putRes.ok) throw new Error(`PUT failed: ${putRes.status}`);
  return { url: key, key };
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
}: UploadDropzoneProps) {
  const [files, setFiles] = React.useState<FileState[]>([]);
  const [dragOver, setDragOver] = React.useState(false);
  const inputRef = React.useRef<HTMLInputElement>(null);

  const processFile = React.useCallback(
    async (idx: number, file: File) => {
      setFiles((prev) => prev.map((f, i) => (i === idx ? { ...f, status: "compressing" } : f)));

      let blob: Blob = file;
      try {
        const cr = await compressImage(file);
        blob = cr.blob;
      } catch {
        // compression failed; upload original
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
            result = await uploadMultipart(blob, file.name, file.type, (p) => {
              setFiles((prev) =>
                prev.map((f, i) =>
                  i === idx ? { ...f, progress: (p.bytesUploaded / p.totalBytes) * 100 } : f
                )
              );
            });
          } else {
            result = await uploadSinglePut(blob, file.name, file.type);
            setFiles((prev) => prev.map((f, i) => (i === idx ? { ...f, progress: 100 } : f)));
          }
          setFiles((prev) =>
            prev.map((f, i) => (i === idx ? { ...f, status: "done", progress: 100 } : f))
          );
          onUploaded({ ...result, filename: file.name, size: file.size, mime: file.type });
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
    [onUploaded, onFailure, jobId]
  );

  const handleFiles = (incoming: File[]) => {
    const accepted = incoming.slice(0, maxFiles);
    const start = files.length;
    setFiles((prev) => [
      ...prev,
      ...accepted.map<FileState>((file) => ({ file, status: "queued", progress: 0, attempt: 0 })),
    ]);
    accepted.forEach((file, i) => processFile(start + i, file));
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
          handleFiles(Array.from(e.dataTransfer.files));
        }}
      >
        <Upload className="size-5 text-muted-foreground" />
        <p className="text-sm text-muted-foreground">Drag files here, or click to choose.</p>
      </div>
      <input
        ref={inputRef}
        type="file"
        multiple
        accept={accept}
        className="sr-only"
        onChange={(e) => e.target.files && handleFiles(Array.from(e.target.files))}
      />
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
                <span className="flex items-center gap-1 text-destructive">
                  <AlertCircle className="size-3" />
                  Failed
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
