"use client";
import { useState } from "react";

/** Existing replacement workflow; the server retains the previous object in its audit. */
export function LaundryEvidenceReplacement({
  confirmationId,
  onSaved,
}: {
  confirmationId: string;
  onSaved: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function replace(file: File) {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const form = new FormData();
      form.append("file", file);
      form.append("folder", "laundry-confirmations");
      const upload = await fetch("/api/uploads/direct", {
        method: "POST",
        body: form,
      });
      const uploaded = await upload.json();
      if (!upload.ok || !uploaded.key)
        throw new Error(uploaded.error || "Could not upload evidence.");
      const response = await fetch(
        `/api/admin/laundry/confirmations/${confirmationId}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ s3Key: uploaded.key, photoUrl: uploaded.url }),
        },
      );
      const result = await response.json();
      if (!response.ok)
        throw new Error(result.error || "Could not replace evidence.");
      onSaved();
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Could not replace evidence.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="space-y-1">
      <label className="block text-xs">
        {busy ? "Saving replacement…" : "Replace confirmation photo"}
        <input
          type="file"
          accept="image/*"
          disabled={busy}
          className="mt-1 block w-full min-w-0 text-xs"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) void replace(file);
            event.target.value = "";
          }}
        />
      </label>
      {error && (
        <p role="alert" className="text-xs text-[hsl(var(--e-danger))]">
          {error}
        </p>
      )}
    </div>
  );
}
