/**
 * Per-job-type service checklists — the editable "what's covered / not covered"
 * source used to (a) attach a checklist to quotes and (b) generate the matching
 * cleaner job form. Each item can carry how-to instructions (text + image +
 * video link) that the cleaner reveals in the form.
 */
export interface ChecklistItem {
  /** Stable key, e.g. "kitchen.benchtops" — links a checklist item to a form field. */
  id: string;
  label: string;
  /** true = included in the service; false = explicitly NOT covered (exclusion). */
  covered: boolean;
  /** How-to cleaning instructions shown in the reveal popup. */
  instructions?: string;
  /** Optional reference image URL. */
  imageUrl?: string;
  /** Optional how-to video — an uploaded file URL or an external link (YouTube etc.). */
  videoUrl?: string;
}

export interface ChecklistSection {
  id: string;
  title: string;
  items: ChecklistItem[];
}

export interface ServiceChecklist {
  jobType: string;
  /** One-line description of the service shown at the top of the checklist. */
  summary?: string;
  /** Explicit "not covered / excluded" notes shown to the client. */
  notCovered?: string[];
  sections: ChecklistSection[];
}

export type ChecklistMap = Record<string, ServiceChecklist>;
