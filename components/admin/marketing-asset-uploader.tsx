"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { UploadDropzone, type UploadResult } from "@/components/ui/upload-dropzone";

function guessMediaType(mime: string, filename: string): "IMAGE" | "VIDEO" | "GIF" {
  if (mime.startsWith("video/") || /\.(mp4|mov|webm|m4v)$/i.test(filename)) return "VIDEO";
  if (mime === "image/gif" || /\.gif$/i.test(filename)) return "GIF";
  return "IMAGE";
}

export default function MarketingAssetUploader() {
  const router = useRouter();
  const [status, setStatus] = useState<string | null>(null);

  async function handleUploaded(result: UploadResult) {
    setStatus("Saving…");
    try {
      const mediaType = guessMediaType(result.mime || "", result.filename);
      const res = await fetch("/api/admin/marketing/assets", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: result.filename,
          url: result.url,
          s3Key: result.key,
          mediaType,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? "Save failed");
      }
      setStatus(`Saved ${result.filename}`);
      router.refresh();
    } catch (err) {
      setStatus(err instanceof Error ? err.message : "Save failed");
    }
  }

  function handleFailure(filename: string, reason: string) {
    setStatus(`Failed to upload ${filename}: ${reason}`);
  }

  return (
    <div className="space-y-2">
      <UploadDropzone
        onUploaded={handleUploaded}
        onFailure={handleFailure}
        accept="image/*,video/*"
        maxFiles={10}
      />
      {status ? (
        <p className="text-xs text-muted-foreground">{status}</p>
      ) : null}
    </div>
  );
}
