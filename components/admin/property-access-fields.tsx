"use client";

import { useMemo, useState } from "react";
import { ExternalLink, MapPinned, Upload, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/hooks/use-toast";

export type PropertyAccessAttachment = {
  name: string;
  url: string;
  key?: string;
  contentType?: string;
};

export type PropertyAccessInfo = {
  lockbox?: string;
  codes?: string;
  parking?: string;
  other?: string;
  instructions?: string;
  attachments?: PropertyAccessAttachment[];
};

type Props = {
  value: PropertyAccessInfo;
  onChange: (next: PropertyAccessInfo) => void;
  addressParts?: {
    address?: string;
    suburb?: string;
    state?: string;
    postcode?: string;
  };
};

export function buildGoogleMapsUrl(input?: {
  address?: string;
  suburb?: string;
  state?: string;
  postcode?: string;
}) {
  const query = [input?.address, input?.suburb, input?.state, input?.postcode]
    .map((part) => (part ?? "").trim())
    .filter(Boolean)
    .join(", ");
  if (!query) return "";
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
}

function normalizeAccessInfo(value?: PropertyAccessInfo): PropertyAccessInfo {
  return {
    lockbox: value?.lockbox ?? "",
    codes: value?.codes ?? "",
    parking: value?.parking ?? "",
    other: value?.other ?? "",
    instructions: value?.instructions ?? "",
    attachments: Array.isArray(value?.attachments) ? value?.attachments : [],
  };
}

export function PropertyAccessFields({ value, onChange, addressParts }: Props) {
  const [uploading, setUploading] = useState(false);
  const data = normalizeAccessInfo(value);
  const mapsUrl = useMemo(() => buildGoogleMapsUrl(addressParts), [addressParts]);

  function patch(next: Partial<PropertyAccessInfo>) {
    onChange({ ...data, ...next });
  }

  async function uploadFiles(fileList: FileList | null) {
    if (!fileList || fileList.length === 0) return;
    setUploading(true);
    try {
      const uploaded: PropertyAccessAttachment[] = [];
      for (const file of Array.from(fileList)) {
        const formData = new FormData();
        formData.append("file", file);
        formData.append("folder", "property-access");
        const res = await fetch("/api/uploads/direct", {
          method: "POST",
          body: formData,
        });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) {
          throw new Error(body.error ?? `Failed to upload ${file.name}`);
        }
        uploaded.push({
          name: file.name,
          url: body.url,
          key: body.key,
          contentType: file.type || undefined,
        });
      }
      patch({ attachments: [...(data.attachments ?? []), ...uploaded] });
      toast({ title: "Access files uploaded", description: `${uploaded.length} file(s) added.` });
    } catch (err: any) {
      toast({
        title: "Upload failed",
        description: err.message ?? "Could not upload access files.",
        variant: "destructive",
      });
    } finally {
      setUploading(false);
    }
  }

  function removeAttachment(index: number) {
    patch({
      attachments: (data.attachments ?? []).filter((_, currentIndex) => currentIndex !== index),
    });
  }

  return (
    <div className="space-y-4 rounded-md border p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-sm font-medium">Access Instructions</p>
          <p className="text-xs text-muted-foreground">
            Save entry notes, access details, and supporting files for this property.
          </p>
        </div>
        {mapsUrl ? (
          <Button type="button" variant="outline" size="sm" asChild>
            <a href={mapsUrl} target="_blank" rel="noreferrer">
              <MapPinned className="mr-2 h-4 w-4" />
              Open in Google Maps
            </a>
          </Button>
        ) : null}
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <div className="space-y-1.5">
          <Label>Lockbox / Key Safe</Label>
          <Input
            value={data.lockbox ?? ""}
            onChange={(e) => patch({ lockbox: e.target.value })}
            placeholder="Lockbox location or code reference"
          />
        </div>
        <div className="space-y-1.5">
          <Label>Access Codes</Label>
          <Input
            value={data.codes ?? ""}
            onChange={(e) => patch({ codes: e.target.value })}
            placeholder="Door, gate, alarm codes"
          />
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <div className="space-y-1.5">
          <Label>Parking / Building Access</Label>
          <Textarea
            value={data.parking ?? ""}
            onChange={(e) => patch({ parking: e.target.value })}
            placeholder="Parking bay, lift, intercom, loading bay, concierge details"
          />
        </div>
        <div className="space-y-1.5">
          <Label>Additional Access Notes</Label>
          <Textarea
            value={data.other ?? ""}
            onChange={(e) => patch({ other: e.target.value })}
            placeholder="Any extra access info that staff should see"
          />
        </div>
      </div>

      <div className="space-y-1.5">
        <Label>Step-by-Step Entry Instructions</Label>
        <Textarea
          value={data.instructions ?? ""}
          onChange={(e) => patch({ instructions: e.target.value })}
          placeholder="Example: Park in visitor bay, use side gate, keypad code, key inside lockbox..."
          className="min-h-[110px]"
        />
      </div>

      <div className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <Label>Access Files / Images</Label>
            <p className="text-xs text-muted-foreground">
              Upload gate photos, entry diagrams, PDFs, or any access reference files.
            </p>
          </div>
          <label className="inline-flex cursor-pointer items-center">
            <input
              type="file"
              className="hidden"
              multiple
              accept="image/*,.pdf,.doc,.docx,.txt,.rtf,.heic,.heif"
              onChange={(e) => {
                void uploadFiles(e.target.files);
                e.currentTarget.value = "";
              }}
            />
            <span className="inline-flex items-center rounded-md border px-3 py-2 text-sm">
              <Upload className="mr-2 h-4 w-4" />
              {uploading ? "Uploading..." : "Upload files"}
            </span>
          </label>
        </div>

        {(data.attachments ?? []).length > 0 ? (
          <div className="grid gap-3 sm:grid-cols-2">
            {(data.attachments ?? []).map((attachment, index) => {
              const isImage = (attachment.contentType ?? "").startsWith("image/");
              return (
                <div key={`${attachment.url}-${index}`} className="rounded-md border p-3">
                  {isImage ? (
                    <img
                      src={attachment.url}
                      alt={attachment.name}
                      className="mb-3 h-32 w-full rounded object-cover"
                    />
                  ) : null}
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{attachment.name}</p>
                      <a
                        href={attachment.url}
                        target="_blank"
                        rel="noreferrer"
                        className="mt-1 inline-flex items-center text-xs text-primary hover:underline"
                      >
                        <ExternalLink className="mr-1 h-3 w-3" />
                        Open file
                      </a>
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={() => removeAttachment(index)}
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">No access files uploaded yet.</p>
        )}
      </div>
    </div>
  );
}

