import { RefreshCw } from "lucide-react";
import { EButton } from "@/components/v2/ui/primitives";
import type { DraftSaveState } from "@/lib/cleaner/use-draft-save";

export function DraftSaveStatus({ state, onRetry }: { state: DraftSaveState; onRetry: () => void }) {
  if (state.phase === "idle") return null;
  if (state.phase === "error") return <div role="alert" className="flex flex-wrap items-center justify-between gap-2 border-l-2 border-[hsl(var(--e-danger))] pl-3 text-sm text-[hsl(var(--e-danger))]">
    <p>{state.message}</p>
    <EButton type="button" size="sm" variant="outline" onClick={onRetry}><RefreshCw className="h-4 w-4" /> Retry save</EButton>
  </div>;
  return <p role="status" className="text-xs text-[hsl(var(--e-muted-foreground))]">{state.phase === "saving" ? "Saving draft..." : "Draft save confirmed"}</p>;
}
