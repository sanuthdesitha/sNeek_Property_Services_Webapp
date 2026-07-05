"use client";

import * as React from "react";
import { Braces, RotateCcw, Save } from "lucide-react";
import type { Dispatch, SetStateAction } from "react";
import type { WebsiteContent } from "@/lib/public-site/content";
import { EButton } from "@/components/v2/ui/primitives";
import { ESectionCard, ETextarea, cloneContent } from "../shared";
import { ESaveStatus, useSaveStatus } from "@/components/v2/admin/settings/estate-form";

export function RawJsonSection({
  content,
  setContent,
  readOnly,
  onSave,
  saving,
  defaults,
}: {
  content: WebsiteContent;
  setContent: Dispatch<SetStateAction<WebsiteContent>>;
  readOnly: boolean;
  onSave: (next: WebsiteContent) => Promise<void>;
  saving: boolean;
  defaults: WebsiteContent;
}) {
  const [raw, setRaw] = React.useState(() => JSON.stringify(content, null, 2));
  const { status, flash } = useSaveStatus();

  // Re-seed the textarea when the saved content changes underneath us (e.g.
  // after a successful save round-trip or a reset elsewhere).
  React.useEffect(() => {
    setRaw(JSON.stringify(content, null, 2));
  }, [content]);

  function parse(): WebsiteContent | null {
    try {
      return JSON.parse(raw) as WebsiteContent;
    } catch (e: any) {
      flash("error", `Invalid JSON: ${e?.message ?? "parse failed"}`);
      return null;
    }
  }

  return (
    <ESectionCard
      title="Advanced raw JSON"
      description="Paste or export the entire public-site content object. The structured tabs above are safer for day-to-day editing."
      actions={<ESaveStatus status={status} />}
    >
      <ETextarea
        rows={26}
        className="font-mono text-[0.75rem]"
        value={raw}
        disabled={readOnly}
        onChange={(e) => setRaw(e.target.value)}
      />
      {!readOnly ? (
        <div className="flex flex-wrap gap-2">
          <EButton
            variant="outline"
            size="sm"
            onClick={() => {
              const parsed = parse();
              if (parsed) {
                setContent(parsed);
                flash("saved", "Draft applied");
              }
            }}
          >
            <Braces className="h-3.5 w-3.5" />
            Apply to draft
          </EButton>
          <EButton
            variant="outline"
            size="sm"
            onClick={() => {
              const reset = cloneContent(defaults);
              setContent(reset);
              setRaw(JSON.stringify(reset, null, 2));
              flash("saved", "Draft reset to defaults");
            }}
          >
            <RotateCcw className="h-3.5 w-3.5" />
            Reset to defaults
          </EButton>
          <EButton
            size="sm"
            disabled={saving}
            onClick={() => {
              const parsed = parse();
              if (parsed) void onSave(parsed);
            }}
          >
            <Save className="h-3.5 w-3.5" />
            {saving ? "Saving…" : "Save JSON"}
          </EButton>
        </div>
      ) : null}
    </ESectionCard>
  );
}
