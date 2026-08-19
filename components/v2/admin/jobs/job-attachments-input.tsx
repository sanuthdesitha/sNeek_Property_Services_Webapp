"use client";

/**
 * Estate-native port of the classic JobAttachmentsInput
 * (components/admin/job-attachments-input.tsx). Same upload contract: each
 * file is uploaded immediately via POST /api/uploads/direct (folder
 * "jobs/reference") and the resulting {key,url,name,...} descriptor is held in
 * the parent's form state until the job POST carries it — so the job-create
 * payload only ever references already-stored files. The chrome (label/help
 * text) is left to the surrounding EField so this stays a pure control.
 */
import { useRef, useState } from "react";
import { X } from "lucide-react";
import { EButton } from "@/components/v2/ui/primitives";
import { toast } from "@/hooks/use-toast";
import type { JobReferenceAttachment } from "@/lib/jobs/meta";

interface JobAttachmentsInputProps {
  value: JobReferenceAttachment[];
  onChange: (next: JobReferenceAttachment[]) => void;
}

async function uploadFile(file: File): Promise<JobReferenceAttachment> {
  const form = new FormData();
  form.append("file", file);
  form.append("folder", "jobs/reference");

  const response = await fetch("/api/uploads/direct", { method: "POST", body: form });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(body.error ?? `Could not upload ${file.name}`);
  }

  return {
    key: body.key,
    url: body.url,
    name: file.name,
    mimeType: file.type || undefined,
    sizeBytes: file.size || undefined,
  };
}

export function JobAttachmentsInput({ value, onChange }: JobAttachmentsInputProps) {
  const [uploading, setUploading] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  async function handleFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    setUploading(true);
    try {
      const uploaded: JobReferenceAttachment[] = [];
      // Sequential on purpose (matches classic): keeps error attribution to a
      // single file and avoids hammering the upload endpoint from one click.
      for (const file of Array.from(files)) {
        uploaded.push(await uploadFile(file));
      }
      // Anything uploaded before a failure is intentionally dropped with the
      // error — partial batches would be confusing to reconcile in the UI.
      onChange([...value, ...uploaded]);
    } finally {
      setUploading(false);
      // Reset so re-picking the same file fires onChange again.
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  function removeAttachment(key: string) {
    onChange(value.filter((item) => item.key !== key));
  }

  return (
    <div className="space-y-2 rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface-raised))] p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-[0.75rem] text-[hsl(var(--e-text-faint))]">
          {value.length === 0
            ? "No reference files yet."
            : `${value.length} file${value.length === 1 ? "" : "s"} attached.`}
        </p>
        <EButton
          type="button"
          variant="outline"
          size="sm"
          disabled={uploading}
          onClick={() => inputRef.current?.click()}
        >
          {uploading ? "Uploading…" : "Add files"}
        </EButton>
      </div>

      <input
        ref={inputRef}
        type="file"
        className="hidden"
        multiple
        accept="image/*,.pdf,.doc,.docx,.txt,.csv,.xls,.xlsx"
        onChange={(event) => {
          handleFiles(event.target.files).catch((err: unknown) => {
            toast({
              title: "Upload failed",
              description: err instanceof Error ? err.message : "Upload failed.",
              variant: "destructive",
            });
          });
        }}
      />

      {value.length > 0 ? (
        <div className="space-y-1.5">
          {value.map((item) => (
            <div
              key={item.key}
              className="flex items-center justify-between gap-2 rounded-[var(--e-radius-sm)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface))] px-2.5 py-1.5"
            >
              <div className="min-w-0">
                <a
                  href={item.url}
                  target="_blank"
                  rel="noreferrer"
                  className="block truncate text-[0.8125rem] font-[550] text-[hsl(var(--e-foreground))] hover:underline"
                >
                  {item.name}
                </a>
                <p className="text-[0.6875rem] text-[hsl(var(--e-text-faint))]">
                  {item.mimeType || "File"}
                  {item.sizeBytes ? ` · ${(item.sizeBytes / 1024 / 1024).toFixed(2)} MB` : ""}
                </p>
              </div>
              <button
                type="button"
                aria-label={`Remove ${item.name}`}
                onClick={() => removeAttachment(item.key)}
                className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[hsl(var(--e-text-faint))] transition-colors hover:bg-[hsl(var(--e-muted))] hover:text-[hsl(var(--e-foreground))]"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
