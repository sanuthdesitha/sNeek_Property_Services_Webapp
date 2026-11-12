/**
 * Plain module (no "use client"): the server page reads these labels, and a
 * value exported from a client module cannot be read on the server.
 */
import type { FormsLibraryTab } from "@/lib/admin/forms-redirects";

export const FORMS_TAB_LABEL: Record<FormsLibraryTab, string> = {
  forms: "Job forms",
  qa: "QA templates",
  blocks: "Checklist blocks",
  messages: "Message templates",
  stats: "Results and stats",
};
