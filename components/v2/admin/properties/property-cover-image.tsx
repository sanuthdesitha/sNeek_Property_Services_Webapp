"use client";

/**
 * Cover photo field for the v2 property workspace — parity with v1's
 * UploadDropzone-based cover upload (app/admin/properties/[id]/page.tsx).
 *
 * Estate-kit constraint: the v2 tree must not import components/ui/*, so this
 * re-implements the minimal single-image path with the same building blocks —
 * compress via lib/uploads/compress, then POST /api/uploads/direct (same-origin
 * upload; presigned bucket PUTs need a CORS policy the bucket doesn't have).
 * The resulting URL is only persisted when the parent saves the property
 * (PATCH /api/admin/properties/:id with imageUrl).
 */
import { useRef, useState } from "react";
import { ImagePlus, Trash2 } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { compressImage } from "@/lib/uploads/compress";
import { EButton } from "@/components/v2/ui/primitives";

export function PropertyCoverImage({
  value,
  onChange,
}: {
  value: string;
  onChange: (url: string) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  async function handleFile(file: File) {
    setUploading(true);
    try {
      // Compression failures fall back to the original file — a big upload is
      // better than a failed one.
      let blob: Blob = file;
      try {
        blob = (await compressImage(file)).blob;
      } catch {
        blob = file;
      }
      const form = new FormData();
      form.append("file", new File([blob], file.name, { type: file.type || "application/octet-stream" }));
      const res = await fetch("/api/uploads/direct", { method: "POST", body: form });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(body.error ?? `Upload failed (${res.status}).`);
      }
      const url = typeof body.url === "string" && body.url ? body.url : body.key;
      if (typeof url !== "string" || !url) {
        throw new Error("Upload returned no file URL.");
      }
      onChange(url);
      toast({ title: "Photo uploaded", description: "Save changes to apply the new cover." });
    } catch (err) {
      toast({
        title: "Upload failed",
        description: err instanceof Error ? err.message : "Could not upload the photo.",
        variant: "destructive",
      });
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  return (
    <div className="space-y-2">
      {value.trim() ? (
        <div className="space-y-2">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={value}
            alt="Cover preview"
            className="h-40 w-full max-w-sm rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] object-cover"
          />
          <div className="flex flex-wrap gap-2">
            <EButton variant="outline" size="sm" disabled={uploading} onClick={() => inputRef.current?.click()}>
              <ImagePlus className="mr-1 h-3.5 w-3.5" /> {uploading ? "Uploading…" : "Replace"}
            </EButton>
            <EButton variant="ghost" size="sm" disabled={uploading} onClick={() => onChange("")}>
              <Trash2 className="mr-1 h-3.5 w-3.5" /> Remove photo
            </EButton>
          </div>
        </div>
      ) : (
        <button
          type="button"
          disabled={uploading}
          onClick={() => inputRef.current?.click()}
          className="flex w-full max-w-sm flex-col items-center justify-center gap-1.5 rounded-[var(--e-radius)] border-2 border-dashed border-[hsl(var(--e-border-strong))] bg-[hsl(var(--e-surface-raised)/0.5)] p-6 text-[0.8125rem] text-[hsl(var(--e-muted-foreground))] transition-colors duration-[160ms] hover:border-[hsl(var(--e-primary))] disabled:opacity-60"
        >
          <ImagePlus className="h-4 w-4" />
          {uploading ? "Uploading…" : "Upload cover photo"}
        </button>
      )}
      <p className="text-[0.75rem] text-[hsl(var(--e-text-faint))]">
        Shown on the Properties grid. Save changes to apply.
      </p>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        className="sr-only"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void handleFile(file);
        }}
      />
    </div>
  );
}
