"use client";

/**
 * Renders the admin-defined custom property intake fields on the create form.
 * Definitions come from the propertyFormConfig (lib/property-form/config.ts);
 * values are held in a flat { [fieldId]: value } map and posted as `customFields`.
 * Only visible fields (condition met) are shown; hidden ones never persist.
 */
import { useRef, useState } from "react";
import { ImagePlus, Upload, X } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { ECard, ECardBody, ECardHeader, ECardTitle, EButton } from "@/components/v2/ui/primitives";
import { EField, EInput, ESelect, ETextarea } from "@/components/v2/admin/estate-kit";
import {
  isCustomFieldVisible,
  isCustomFieldRequired,
  type CustomFieldDef,
} from "@/lib/property-form/config";

type MediaValue = { url: string; key: string };

export function CustomFieldsSection({
  fields,
  values,
  formValues,
  onChange,
}: {
  fields: CustomFieldDef[];
  values: Record<string, unknown>;
  /** Combined system + custom values used to evaluate conditional visibility. */
  formValues: Record<string, unknown>;
  onChange: (id: string, value: unknown) => void;
}) {
  const visible = fields.filter((f) => isCustomFieldVisible(f, formValues));
  if (visible.length === 0) return null;

  return (
    <ECard>
      <ECardHeader className="pb-2">
        <ECardTitle className="text-[0.95rem]">Additional details</ECardTitle>
      </ECardHeader>
      <ECardBody className="space-y-4 pt-0">
        {visible.map((field) => (
          <CustomFieldControl
            key={field.id}
            field={field}
            value={values[field.id]}
            required={isCustomFieldRequired(field, formValues)}
            onChange={(v) => onChange(field.id, v)}
          />
        ))}
      </ECardBody>
    </ECard>
  );
}

function CustomFieldControl({
  field,
  value,
  required,
  onChange,
}: {
  field: CustomFieldDef;
  value: unknown;
  required: boolean;
  onChange: (value: unknown) => void;
}) {
  const label = required ? `${field.label} *` : field.label;

  if (field.type === "yesno") {
    const v = value === true ? "yes" : value === false ? "no" : "";
    return (
      <EField label={label} hint={field.helpText}>
        <div className="flex overflow-hidden rounded-[var(--e-radius)] border border-[hsl(var(--e-border))]">
          {[
            { k: "yes", label: "Yes", val: true },
            { k: "no", label: "No", val: false },
          ].map((opt) => (
            <button
              key={opt.k}
              type="button"
              onClick={() => onChange(opt.val)}
              className={`px-4 py-1.5 text-[0.8125rem] transition ${
                v === opt.k
                  ? "bg-[hsl(var(--e-primary))] text-[hsl(var(--e-primary-foreground))]"
                  : "text-[hsl(var(--e-text-faint))] hover:bg-[hsl(var(--e-surface-raised))]"
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </EField>
    );
  }

  if (field.type === "select") {
    return (
      <EField label={label} hint={field.helpText}>
        <ESelect value={typeof value === "string" ? value : ""} onChange={(e) => onChange(e.target.value)}>
          <option value="">Select…</option>
          {(field.options ?? []).map((opt) => (
            <option key={opt} value={opt}>
              {opt}
            </option>
          ))}
        </ESelect>
      </EField>
    );
  }

  if (field.type === "longtext") {
    return (
      <EField label={label} hint={field.helpText}>
        <ETextarea
          value={typeof value === "string" ? value : ""}
          placeholder={field.placeholder}
          onChange={(e) => onChange(e.target.value)}
        />
      </EField>
    );
  }

  if (field.type === "number") {
    return (
      <EField label={label} hint={field.helpText}>
        <EInput
          type="number"
          value={value == null ? "" : String(value)}
          placeholder={field.placeholder}
          onChange={(e) => onChange(e.target.value === "" ? "" : Number(e.target.value))}
        />
      </EField>
    );
  }

  if (field.type === "photo" || field.type === "file") {
    return (
      <MediaField
        label={label}
        hint={field.helpText}
        accept={field.type === "photo" ? "image/*" : undefined}
        value={value as MediaValue | undefined}
        onChange={onChange}
      />
    );
  }

  // text
  return (
    <EField label={label} hint={field.helpText}>
      <EInput
        value={typeof value === "string" ? value : ""}
        placeholder={field.placeholder}
        onChange={(e) => onChange(e.target.value)}
      />
    </EField>
  );
}

function MediaField({
  label,
  hint,
  accept,
  value,
  onChange,
}: {
  label: string;
  hint?: string;
  accept?: string;
  value: MediaValue | undefined;
  onChange: (value: MediaValue | null) => void;
}) {
  const [uploading, setUploading] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const isImage = accept === "image/*";

  async function onFiles(files: FileList | null) {
    const file = files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("folder", "property-custom");
      const res = await fetch("/api/uploads/direct", { method: "POST", body: fd });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || !body.url || !body.key) {
        toast({ title: "Upload failed", description: body.error ?? file.name, variant: "destructive" });
        return;
      }
      onChange({ url: body.url, key: body.key });
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  return (
    <EField label={label} hint={hint}>
      <div className="flex flex-wrap items-center gap-3">
        {value?.url ? (
          isImage ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={value.url}
              alt={label}
              className="h-16 w-16 rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] object-cover"
            />
          ) : (
            <a
              href={value.url}
              target="_blank"
              rel="noreferrer"
              className="text-[0.8125rem] text-[hsl(var(--e-primary))] underline"
            >
              View uploaded file
            </a>
          )
        ) : null}
        <EButton
          type="button"
          variant="outline"
          size="sm"
          disabled={uploading}
          onClick={() => inputRef.current?.click()}
        >
          {isImage ? <ImagePlus className="mr-1 h-3.5 w-3.5" /> : <Upload className="mr-1 h-3.5 w-3.5" />}
          {uploading ? "Uploading…" : value?.url ? "Replace" : isImage ? "Add photo" : "Upload file"}
        </EButton>
        {value?.url ? (
          <EButton type="button" variant="ghost" size="sm" onClick={() => onChange(null)}>
            <X className="mr-1 h-3.5 w-3.5" /> Remove
          </EButton>
        ) : null}
        <input
          ref={inputRef}
          type="file"
          accept={accept}
          className="hidden"
          onChange={(e) => onFiles(e.target.files)}
        />
      </div>
    </EField>
  );
}
