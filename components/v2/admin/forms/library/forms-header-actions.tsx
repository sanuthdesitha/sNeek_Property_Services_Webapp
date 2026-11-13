"use client";

/**
 * The Forms page header's actions. From 640px up: Import and "New form ▾",
 * exactly as before. On a phone (board "M-InsightsForms"): Import moves into
 * the header's "⋯" menu (it opens the same import dialog) and "New form ▾"
 * docks at the bottom in thumb reach, with the same items.
 */
import * as React from "react";
import { ChevronDown } from "lucide-react";
import { ERowMenu } from "@/components/v2/ui/row-menu";
import { EPhoneActionBar } from "@/components/v2/ui/phone-bars";
import { useIsPhone } from "@/components/v2/ui/use-phone";
import { ImportFormsButton } from "./import-forms";
import { NewFormMenu, newFormItems } from "./new-form-menu";

export function FormsHeaderActions({ canImport, canQa, canMessages }: { canImport: boolean; canQa: boolean; canMessages: boolean }) {
  const phone = useIsPhone();
  const [importRequest, setImportRequest] = React.useState(0);

  if (!phone) {
    return (
      <div className="flex flex-wrap items-center gap-2 max-sm:hidden">
        {canImport ? <ImportFormsButton /> : null}
        <NewFormMenu canQa={canQa} canMessages={canMessages} />
      </div>
    );
  }
  return (
    <>
      {canImport ? (
        <>
          <ERowMenu
            label="More forms actions"
            triggerVariant="outline"
            items={[{ key: "import", label: "Import forms…", onSelect: () => setImportRequest((count) => count + 1) }]}
          />
          <ImportFormsButton openRequest={importRequest} hideTrigger />
        </>
      ) : null}
      <EPhoneActionBar
        label="Forms actions"
        primary={
          <ERowMenu
            label="New form"
            items={newFormItems(canQa, canMessages)}
            className="w-full justify-center"
            trigger={
              <>
                New form <ChevronDown aria-hidden className="h-3.5 w-3.5" />
              </>
            }
          />
        }
      />
    </>
  );
}
