"use client";

import { useState } from "react";
import { Plus, Trash2, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/hooks/use-toast";

const DETAIL_TYPES = [
  { value: "LOCKBOX", label: "Lockbox code" },
  { value: "KEY_LOCATION", label: "Key location" },
  { value: "PARKING", label: "Parking instructions" },
  { value: "BUILDING_ACCESS", label: "Building access" },
  { value: "ENTRY_PHOTO", label: "Entry photo" },
];

interface AccessDetail {
  detailType: string;
  value: string;
  photoUrl: string;
  photoKey: string;
  sortOrder: number;
}

interface StepAccessProps {
  data: Record<string, unknown>;
  onChange: (data: Record<string, unknown>) => void;
}

export function StepAccess({ data, onChange }: StepAccessProps) {
  const [uploading, setUploading] = useState(false);
  const details: AccessDetail[] = (data.accessDetails as AccessDetail[]) ?? [];

  const addDetail = (type: string) => {
    onChange({
      ...data,
      accessDetails: [...details, { detailType: type, value: "", photoUrl: "", photoKey: "", sortOrder: details.length }],
    });
  };

  const updateDetail = (index: number, field: keyof AccessDetail, value: unknown) => {
    const updated = [...details];
    updated[index] = { ...updated[index], [field]: value };
    onChange({ ...data, accessDetails: updated });
  };

  const removeDetail = (index: number) => {
    onChange({ ...data, accessDetails: details.filter((_, i) => i !== index) });
  };

  const uploadPhoto = async (file: File, index: number) => {
    setUploading(true);
    try {
      const form = new FormData();
      form.append("file", file);
      form.append("folder", "onboarding-access");
      const res = await fetch("/api/uploads/direct", { method: "POST", body: form });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? "Upload failed");
      updateDetail(index, "photoUrl", body.url);
      updateDetail(index, "photoKey", body.key);
      toast({ title: "Photo uploaded" });
    } catch (err: any) {
      toast({ title: "Upload failed", description: err.message, variant: "destructive" });
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Add access details: lockbox codes, key locations, parking instructions, and entry photos.
      </p>

      {details.length === 0 && (
        <div className="rounded-lg border-2 border-dashed p-6 text-center text-sm text-muted-foreground">
          No access details added yet.
        </div>
      )}

      {details.map((detail, i) => (
        <div key={i} className="flex flex-col gap-3 rounded-lg border p-4">
          <div className="flex items-center gap-2">
            <Select value={detail.detailType} onValueChange={(v) => updateDetail(i, "detailType", v)}>
              <SelectTrigger className="w-[200px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                {DETAIL_TYPES.map((t) => (
                  <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button variant="ghost" size="icon" onClick={() => removeDetail(i)}>
              <Trash2 className="h-4 w-4 text-destructive" />
            </Button>
          </div>

          {detail.detailType === "ENTRY_PHOTO" ? (
            <div className="space-y-2">
              <label className="inline-flex cursor-pointer items-center gap-2 rounded-md border px-3 py-2 text-xs hover:bg-muted">
                <Upload className="h-3.5 w-3.5" />
                {uploading ? "Uploading..." : "Upload photo"}
                <input
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => {
                    if (e.target.files?.[0]) uploadPhoto(e.target.files[0], i);
                    e.currentTarget.value = "";
                  }}
                />
              </label>
              {detail.photoUrl && (
                <img src={detail.photoUrl} alt="Access" className="max-h-48 rounded-md border object-cover" />
              )}
            </div>
          ) : (
            <Textarea
              value={detail.value}
              onChange={(e) => updateDetail(i, "value", e.target.value)}
              placeholder={`Enter ${DETAIL_TYPES.find(t => t.value === detail.detailType)?.label?.toLowerCase() ?? "details"}`}
            />
          )}
        </div>
      ))}

      <div className="flex flex-wrap gap-2">
        {DETAIL_TYPES.map((t) => (
          <Button key={t.value} variant="outline" size="sm" onClick={() => addDetail(t.value)}>
            <Plus className="mr-1 h-3 w-3" />
            {t.label}
          </Button>
        ))}
      </div>
    </div>
  );
}
