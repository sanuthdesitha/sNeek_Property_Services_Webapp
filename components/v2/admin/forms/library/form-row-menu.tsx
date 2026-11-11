"use client";

/**
 * A form row's "more" menu: the single-form actions the old list offered as
 * buttons (duplicate, publish, archive / unarchive, delete) plus a link to the
 * form's results. Delete keeps its PIN/password confirmation (the dialog lives
 * in the list); every item only starts the action.
 */
import * as React from "react";
import { ERowMenu, type ERowMenuItem } from "@/components/v2/ui/row-menu";
import type { FormLibraryRow } from "@/lib/forms/library-types";
import { exportFormsHref } from "./import-forms";

export type FormRowActions = {
  duplicate: (row: FormLibraryRow) => void;
  publish: (row: FormLibraryRow) => void;
  archive: (row: FormLibraryRow) => void;
  unarchive: (row: FormLibraryRow) => void;
  remove: (row: FormLibraryRow) => void;
};

export function FormRowMenu({ row, actions, busy }: { row: FormLibraryRow; actions: FormRowActions; busy: boolean }) {
  const canPublish = row.status === "draft" || row.status === "live-draft";
  const items: ERowMenuItem[] = [
    { key: "duplicate", label: "Duplicate as a draft", onSelect: () => actions.duplicate(row) },
    ...(canPublish
      ? [{ key: "publish", label: row.status === "live-draft" ? "Publish changes" : "Publish", onSelect: () => actions.publish(row) }]
      : []),
    row.status === "archived"
      ? { key: "unarchive", label: "Unarchive (stays a draft)", onSelect: () => actions.unarchive(row) }
      : { key: "archive", label: "Archive", onSelect: () => actions.archive(row) },
    { key: "export", label: "Export as a file", href: exportFormsHref([row.id]) },
    { key: "stats", label: "Results and stats", href: `/v2/admin/forms?tab=stats&templateId=${encodeURIComponent(row.id)}` },
    { key: "delete", label: "Delete…", danger: true, separated: true, onSelect: () => actions.remove(row) },
  ];
  return <ERowMenu label={`More actions for ${row.name}`} items={items} disabled={busy} />;
}
