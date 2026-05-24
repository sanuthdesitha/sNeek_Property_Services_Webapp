import { requireSession } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { DisplayPreferencesForm } from "@/components/admin/display-preferences-form";

export default async function DisplaySettingsPage() {
  const session = await requireSession();
  const user = await db.user.findUnique({
    where: { id: session.user.id },
    select: { uiDensity: true, themePreference: true },
  });

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-foreground">Display Preferences</h2>
        <p className="text-sm text-muted-foreground">
          Choose how the dashboard looks for you. Changes save instantly.
        </p>
      </div>

      <DisplayPreferencesForm
        initialDensity={user?.uiDensity ?? "DEFAULT"}
        initialTheme={user?.themePreference ?? "SYSTEM"}
      />
    </div>
  );
}
