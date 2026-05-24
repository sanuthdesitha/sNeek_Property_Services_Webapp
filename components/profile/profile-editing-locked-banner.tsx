import { Lock } from "lucide-react";

export function ProfileEditingLockedBanner() {
  return (
    <div
      role="status"
      className="flex items-start gap-3 rounded-md border border-warning/40 bg-warning/10 px-4 py-3 text-sm text-warning-foreground"
    >
      <Lock className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
      <div className="space-y-0.5">
        <p className="font-medium">Profile editing has been disabled.</p>
        <p className="text-xs text-warning-foreground/80">
          Contact an administrator to make changes to your profile.
        </p>
      </div>
    </div>
  );
}
