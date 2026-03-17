"use client";

import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { X } from "lucide-react";
import type { JobReferenceAttachment } from "@/lib/jobs/meta";
import { toast } from "@/hooks/use-toast";

interface JobAttachmentsInputProps {
  value: JobReferenceAttachment[];
  onChange: (next: JobReferenceAttachment[]) => void;
}

export function JobAttachmentsInput({ value, onChange }: JobAttachmentsInputProps) {
  const [uploading, setUploading] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  async function uploadFile(file: File): Promise<JobReferenceAttachment> {
    const form = new FormData();
    form.append("file", file);
    form.append("folder", "jobs/reference");

    const response = await fetch("/api/uploads/direct", {
      method: "POST",
      body: form,
    });
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

  async function handleFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    setUploading(true);
    try {
      const uploaded: JobReferenceAttachment[] = [];
      for (const file of Array.from(files)) {
        uploaded.push(await uploadFile(file));
      }
      onChange([...value, ...uploaded]);
    } finally {
      setUploading(false);
      if (inputRef.current) {
        inputRef.current.value = "";
      }
    }
  }

  function removeAttachment(key: string) {
    onChange(value.filter((item) => item.key !== key));
  }

  return (
    <div className="space-y-3 rounded-2xl border border-border/70 bg-white/60 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-sm font-medium">Reference files</p>
          <p className="text-xs text-muted-foreground">
            Upload photos, PDFs, or notes that the team needs before the job starts.
          </p>
        </div>
        <Button type="button" size="sm" variant="outline" disabled={uploading} onClick={() => inputRef.current?.click()}>
          {uploading ? "Uploading..." : "Add files"}
        </Button>
      </div>

      <input
        ref={inputRef}
        type="file"
        className="hidden"
        multiple
        accept="image/*,.pdf,.doc,.docx,.txt,.csv,.xls,.xlsx"
        onChange={(event) => {
          handleFiles(event.target.files).catch((err) => {
            toast({
              title: "Upload failed",
              description: err instanceof Error ? err.message : "Upload failed.",
              variant: "destructive",
            });
          });
        }}
      />

      {value.length > 0 ? (
        <div className="space-y-2">
          {value.map((item) => (
            <div
              key={item.key}
              className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border/70 bg-background/70 px-3 py-2"
            >
              <div className="min-w-0">
                <a
                  href={item.url}
                  target="_blank"
                  rel="noreferrer"
                  className="block truncate text-sm font-medium text-primary hover:underline"
                >
                  {item.name}
                </a>
                <p className="text-xs text-muted-foreground">
                  {item.mimeType || "File"}
                  {item.sizeBytes ? ` • ${(item.sizeBytes / 1024 / 1024).toFixed(2)} MB` : ""}
                </p>
              </div>
              <Button type="button" size="icon" variant="ghost" onClick={() => removeAttachment(item.key)}>
                <X className="h-4 w-4" />
              </Button>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">No job reference files added yet.</p>
      )}
    </div>
  );
}
