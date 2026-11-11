/**
 * Lets a component that measures its own upload (bytes sent, compression
 * phase) describe the batch to the single activity bar, instead of drawing its
 * own spinner and per-file bars.
 */
export type LiveBatchItem = {
  /** 0–100, or null before the first measurement. */
  percent: number | null;
  phase?: "compressing" | "uploading";
};

export type LiveBatch = {
  id: string;
  total: number;
  done: number;
  failed: number;
  inFlight: LiveBatchItem[];
};

export type EndedBatch = { done: number; failed: number };

type Listener = {
  onLive: (batches: LiveBatch[]) => void;
  onEnd: (result: EndedBatch) => void;
};

const batches = new Map<string, LiveBatch>();
const listeners = new Set<Listener>();

const emit = () => {
  const snapshot = Array.from(batches.values());
  listeners.forEach((listener) => listener.onLive(snapshot));
};

export function publishActivityBatch(batch: LiveBatch): void {
  batches.set(batch.id, batch);
  emit();
}

/** Files neither done nor failed (a cancelled batch) are simply not counted. */
export function endActivityBatch(id: string, result: EndedBatch): void {
  if (!batches.delete(id)) return;
  listeners.forEach((listener) => listener.onEnd(result));
  emit();
}

export function hasLiveActivityBatch(): boolean {
  return batches.size > 0;
}

export function subscribeActivityBatches(listener: Listener): () => void {
  listeners.add(listener);
  listener.onLive(Array.from(batches.values()));
  return () => {
    listeners.delete(listener);
  };
}
