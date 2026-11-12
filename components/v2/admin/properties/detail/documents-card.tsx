"use client";

/**
 * "Documents and additional details": files and answers captured when the
 * property was created (access files in accessInfo.attachments, and the
 * custom intake fields from the property form). Shown only when the property
 * has some. "Add file" uploads through the existing direct upload and adds
 * the file to the property's access files (the same list the create form
 * fills); nothing else is changed.
 */
import { useRef, useState } from "react";
import { toast } from "@/hooks/use-toast";
import { EButton, ECard } from "@/components/v2/ui/primitives";
import type { PropertyOverview } from "@/lib/properties/preview-types";
import { CardHead, Muted } from "./section-card";
import { legacyCodeCarry, type PropertyRecord } from "./property-record";
import type { SaveResult } from "./use-property-record";

type Attachment = { name: string; url: string; key?: string; contentType?: string };

function storedAttachments(property: PropertyRecord): Attachment[] {
  const raw = property.accessInfo?.attachments;
  return Array.isArray(raw) ? (raw.filter((item) => item && typeof (item as Attachment).url === "string") as Attachment[]) : [];
}

export function DocumentsCard({
  property,
  overview,
  save,
  onSaved,
}: {
  property: PropertyRecord;
  overview: PropertyOverview | null;
  save: (patch: Record<string, unknown>) => Promise<SaveResult>;
  onSaved: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  if (!overview || (overview.documents.length === 0 && overview.details.length === 0)) return null;

  async function addFile(file: File) {
    setUploading(true);
    try {
      const form = new FormData();
      form.append("file", file);
      const response = await fetch("/api/uploads/direct", { method: "POST", body: form });
      const body = (await response.json().catch(() => ({}))) as { url?: string; key?: string; error?: string };
      if (!response.ok) throw new Error(body.error ?? `Upload failed (${response.status}).`);
      const url = body.url || body.key;
      if (!url) throw new Error("Upload returned no file URL.");
      const next: Attachment[] = [...storedAttachments(property), { name: file.name, url, key: body.key, contentType: file.type || undefined }];
      const result = await save({ accessInfo: { attachments: next }, ...legacyCodeCarry(property) });
      if (!result.ok) throw new Error(result.error);
      toast({ title: "File added" });
      onSaved();
    } catch (error) {
      toast({ title: "Could not add the file", description: error instanceof Error ? error.message : "Upload failed.", variant: "destructive" });
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  return (
    <ECard className="flex flex-col gap-2 p-4">
      <CardHead
        title="Documents and additional details"
        action={
          <>
            <input ref={inputRef} type="file" className="sr-only" aria-label="Choose a file to add" onChange={(event) => { const file = event.target.files?.[0]; if (file) void addFile(file); }} />
            <EButton size="sm" variant="outline" disabled={uploading} onClick={() => inputRef.current?.click()}>{uploading ? "Uploading…" : "Add file"}</EButton>
          </>
        }
      />
      {overview.documents.length > 0 ? (
        <p className="text-[0.8125rem]">
          {overview.documents.map((document, index) => (
            <span key={`${document.url}-${index}`}>
              {index > 0 ? " · " : ""}
              <a className="underline" href={document.url} target="_blank" rel="noreferrer">{document.name}</a>
              {document.source === "intake" ? <Muted> ({document.label})</Muted> : null}
            </span>
          ))}{" "}
          <Muted>· captured when the property was created or added here</Muted>
        </p>
      ) : null}
      {overview.details.length > 0 ? (
        <dl className="grid grid-cols-[minmax(0,10rem)_minmax(0,1fr)] gap-x-2.5 gap-y-1 text-[0.8125rem]">
          {overview.details.map((detail) => (
            <div key={detail.label} className="contents">
              <dt className="text-[hsl(var(--e-muted-foreground))]">{detail.label}</dt>
              <dd className="min-w-0 break-words">{detail.value}</dd>
            </div>
          ))}
        </dl>
      ) : null}
    </ECard>
  );
}
