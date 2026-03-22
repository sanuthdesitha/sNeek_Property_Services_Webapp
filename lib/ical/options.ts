export interface IcalSyncOptions {
  ignorePastDates: boolean;
  autoCreateTurnoverJobs: boolean;
  updateExistingLinkedJobs: boolean;
  verifyFeedDuplicates: boolean;
  verifyExistingJobConflicts: boolean;
}

export const DEFAULT_ICAL_SYNC_OPTIONS: IcalSyncOptions = {
  ignorePastDates: true,
  autoCreateTurnoverJobs: true,
  updateExistingLinkedJobs: true,
  verifyFeedDuplicates: true,
  verifyExistingJobConflicts: true,
};

interface StoredIntegrationNotes {
  noteText?: string;
  syncOptions?: Partial<IcalSyncOptions>;
}

export function parseIntegrationNotes(notes: unknown): {
  noteText: string;
  syncOptions: IcalSyncOptions;
} {
  if (typeof notes !== "string" || !notes.trim()) {
    return { noteText: "", syncOptions: { ...DEFAULT_ICAL_SYNC_OPTIONS } };
  }

  try {
    const parsed = JSON.parse(notes) as StoredIntegrationNotes;
    if (parsed && typeof parsed === "object") {
      return {
        noteText: typeof parsed.noteText === "string" ? parsed.noteText : "",
        syncOptions: {
          ...DEFAULT_ICAL_SYNC_OPTIONS,
          ...(parsed.syncOptions ?? {}),
        },
      };
    }
  } catch {
    return { noteText: notes.trim(), syncOptions: { ...DEFAULT_ICAL_SYNC_OPTIONS } };
  }

  return { noteText: "", syncOptions: { ...DEFAULT_ICAL_SYNC_OPTIONS } };
}

export function serializeIntegrationNotes(input: {
  existingNotes?: string | null;
  noteText?: string;
  syncOptions?: Partial<IcalSyncOptions>;
}) {
  const current = parseIntegrationNotes(input.existingNotes);
  const noteText = typeof input.noteText === "string" ? input.noteText : current.noteText;
  const syncOptions = {
    ...current.syncOptions,
    ...(input.syncOptions ?? {}),
  };

  if (!noteText && JSON.stringify(syncOptions) === JSON.stringify(DEFAULT_ICAL_SYNC_OPTIONS)) {
    return null;
  }

  return JSON.stringify({
    ...(noteText ? { noteText } : {}),
    syncOptions,
  });
}
