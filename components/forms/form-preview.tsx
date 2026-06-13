"use client";

import * as React from "react";
import { Camera, Video, FileText } from "lucide-react";
import { Card } from "@/components/ui/card";
import type { FormSchema } from "@/lib/forms/types";
import { isUploadFieldType } from "@/lib/forms/field-types";
import { flattenFieldsOneLevel, isFlattenedFieldVisible } from "@/lib/forms/visibility";
import { FieldRenderer } from "./field-renderer";
import { FieldReferences } from "./field-references";
import { FormThemeScope, ThemedSectionHeading } from "./form-theme";

/**
 * Interactive live preview of a template, rendered with the exact same
 * FieldRenderer the cleaner job page uses. Answers are local state, so the
 * builder can exercise conditions, sub-fields, and "details when No" live.
 * Upload fields render as the dashed capture tile the cleaner sees.
 *
 * Honours `schema.theme` (accent colour, header colour, logo, dividers, fonts)
 * scoped to the preview container so the rest of the builder chrome is
 * untouched.
 */
export function FormPreview({ schema }: { schema: FormSchema }) {
  const [answers, setAnswers] = React.useState<Record<string, unknown>>({});
  const property = React.useMemo(() => ({ hasBalcony: true }), []);

  const sections = Array.isArray(schema?.sections) ? schema.sections : [];

  return (
    <FormThemeScope theme={schema?.theme} className="space-y-3">
      {sections.length === 0 ? (
        <div className="rounded-xl border-2 border-dashed p-6 text-center text-sm text-muted-foreground">
          Add a section to see the live preview.
        </div>
      ) : null}
      {sections.map((section: any) => {
        const visibleFields = flattenFieldsOneLevel(section?.fields).filter((field) =>
          isFlattenedFieldVisible(field, answers, property)
        );
        return (
          <Card key={section.id} className="space-y-3 rounded-xl p-4">
            <ThemedSectionHeading
              title={section.title ?? section.label ?? "Section"}
              description={section.description}
            />
            {visibleFields.length === 0 ? (
              <p className="text-xs text-muted-foreground">No visible fields.</p>
            ) : null}
            {visibleFields.map((field: any) =>
              isUploadFieldType(field.type) ? (
                <div
                  key={field.id}
                  className={`space-y-1 ${field._isChild ? "ml-4 border-l-2 border-border pl-3" : ""}`}
                >
                  <p className="text-xs font-medium text-muted-foreground">
                    {field.label}
                    {field.required ? " *" : ""}
                    {field.locationTag ? ` · ${field.locationTag}` : ""}
                  </p>
                  {/* Surface example references for upload fields too. */}
                  <FieldReferences references={field.references} />
                  <div className="flex min-h-20 flex-col items-center justify-center gap-1 rounded-lg border-2 border-dashed p-2 text-xs text-muted-foreground">
                    {field.type === "video" ? (
                      <Video className="size-5" />
                    ) : field.type === "file" ? (
                      <FileText className="size-5" />
                    ) : (
                      <Camera className="size-5" />
                    )}
                    {field.type === "video"
                      ? "Video upload"
                      : field.type === "file"
                        ? "File upload"
                        : `Photo upload${field.minPhotos ? ` · min ${field.minPhotos}` : ""}`}
                  </div>
                </div>
              ) : (
                <FieldRenderer
                  key={field.id}
                  field={field}
                  answers={answers}
                  onAnswer={(fieldId, value) =>
                    setAnswers((prev) => ({ ...prev, [fieldId]: value }))
                  }
                />
              )
            )}
          </Card>
        );
      })}
    </FormThemeScope>
  );
}
