"use client";

/**
 * Reference photos for ONE job notice.
 *
 * Split out of job-manage.tsx rather than inlined: the notices editor sits
 * inside an already-large section component, and an uploader carries its own
 * async/error state that has no business widening that file's state surface.
 *
 * Same upload contract as the sibling JobAttachmentsInput — each file goes to
 * POST /api/uploads/direct immediately and only the resulting URL is held in
 * form state, so the job PATCH only ever references already-stored files. The
 * folder differs ("jobs/notices") so notice photos are distinguishable from
 * job reference documents in the bucket.
 *
 * Only the URL is kept, not the {key,url,name} descriptor an attachment uses:
 * both readers of a notice (the admin job page and the cleaner's start-briefing
 * dialog) render a plain <img>, and a notice photo is never listed, renamed or
 * re-signed the way an attachment is.
 */
import { useRef, useState } from "react";
import { ImagePlus, X } from "lucide-react";
import { EButton } from "@/components/v2/ui/primitives";
import { EConfirmButton } from "@/components/v2/admin/estate-kit";
import { toast } from "@/hooks/use-toast";

/** Low on purpose — see the matching cap in jobNoticeSchema. */
const MAX_IMAGES = 6;

interface NoticeImagesInputProps {
  value: string[];
  onChange: (next: string[]) => void;
}

async function uploadNoticeImage(file: File): Promise<string> {
  const form = new FormData();
  form.append("file", file);
  form.append("folder", "jobs/notices");

  const response = await fetch("/api/uploads/direct", { method: "POST", body: form });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || typeof body.url !== "string") {
    throw new Error(body.error ?? `Could not upload ${file.name}`);
  }
  return body.url;
}

export function NoticeImagesInput({ value, onChange }: NoticeImagesInputProps) {
  const [uploading, setUploading] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const remaining = MAX_IMAGES - value.length;

  async function handleFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    // Truncate rather than reject the whole batch: an author who multi-selects
    // eight photos should get the first six, not an error and nothing.
    const picked = Array.from(files).slice(0, Math.max(remaining, 0));
    if (picked.length === 0) {
      toast({ title: `A notice can carry at most ${MAX_IMAGES} photos.` });
      return;
    }

    setUploading(true);
    try {
      const uploaded: string[] = [];
      // Sequential so a failure names the file that caused it.
      for (const file of picked) {
        uploaded.push(await uploadNoticeImage(file));
      }
      onChange([...value, ...uploaded]);
    } finally {
      setUploading(false);
      // Reset so re-picking the same file fires onChange again.
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <EButton
          type="button"
          variant="outline"
          size="sm"
          disabled={uploading || remaining <= 0}
          onClick={() => inputRef.current?.click()}
        >
          <ImagePlus className="h-3.5 w-3.5" />
          {uploading ? "Uploading…" : "Add photo"}
        </EButton>
        <span className="text-[0.6875rem] text-[hsl(var(--e-text-faint))]">
          {value.length === 0
            ? "Optional — a photo of the gate, the latch, where the key sits."
            : `${value.length} photo${value.length === 1 ? "" : "s"} attached.`}
        </span>
      </div>

      <input
        ref={inputRef}
        type="file"
        className="hidden"
        multiple
        accept="image/*"
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
        <div className="flex flex-wrap gap-2">
          {value.map((url) => (
            <div
              key={url}
              className="group relative h-16 w-16 overflow-hidden rounded-[var(--e-radius-sm)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface))]"
            >
              {/* Plain <img>: these are arbitrary uploaded URLs, and next/image
                  would need every storage host whitelisted to render them. */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={url} alt="Notice reference" className="h-full w-full object-cover" />
              {/* Low tier: the photo stays uploaded; this only detaches it. */}
              <EConfirmButton
                ariaLabel="Remove photo"
                confirmLabel={<X className="h-3 w-3 text-[hsl(var(--e-danger))]" />}
                onConfirm={() => onChange(value.filter((item) => item !== url))}
                className="absolute right-0.5 top-0.5 flex h-5 w-5 items-center justify-center rounded-full bg-[hsl(var(--e-surface))]/90 text-[hsl(var(--e-text-faint))] transition-colors hover:bg-[hsl(var(--e-muted))]"
              >
                <X className="h-3 w-3" />
              </EConfirmButton>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
