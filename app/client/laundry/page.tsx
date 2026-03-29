import { format } from "date-fns";
import { toZonedTime } from "date-fns-tz";
import { Shirt } from "lucide-react";
import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { getAppSettings } from "@/lib/settings";
import { getClientPortalContext } from "@/lib/client/portal";
import { listClientLaundryForUser } from "@/lib/client/portal-data";
import { ensureClientModuleAccess } from "@/lib/portal-access";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { MediaGallery } from "@/components/shared/media-gallery";

const TZ = "Australia/Sydney";

export default async function ClientLaundryPage() {
  await ensureClientModuleAccess("laundry");
  const session = await requireRole([Role.CLIENT]);
  const settings = await getAppSettings();
  const portal = await getClientPortalContext(session.user.id, settings);
  const tasks = await listClientLaundryForUser(session.user.id);

  const upcoming = tasks.filter((task) => ["PENDING", "CONFIRMED", "PICKED_UP"].includes(task.status));
  const completed = tasks.filter((task) => ["DROPPED_OFF", "COMPLETED"].includes(task.status));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Laundry</h1>
        <p className="text-sm text-muted-foreground">
          Read-only laundry schedule and timeline for your properties.
        </p>
      </div>

      <section className="grid gap-4 sm:grid-cols-3">
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Upcoming actions</p>
            <p className="text-2xl font-bold">{upcoming.length}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Completed updates</p>
            <p className="text-2xl font-bold">{completed.length}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Properties covered</p>
            <p className="text-2xl font-bold">{new Set(tasks.map((task) => task.property.id)).size}</p>
          </CardContent>
        </Card>
      </section>

      <div className="space-y-4">
        {tasks.map((task) => (
          <Card key={task.id}>
            <CardHeader className="pb-3">
              <CardTitle className="flex flex-wrap items-center justify-between gap-3 text-base">
                <span className="flex items-center gap-2">
                  <span className="flex h-9 w-9 items-center justify-center rounded-2xl bg-primary/10">
                    <Shirt className="h-4 w-4 text-primary" />
                  </span>
                  <span>
                    {task.property.name} • {task.job.jobNumber ? `Job ${task.job.jobNumber}` : task.job.jobType.replace(/_/g, " ")}
                  </span>
                </span>
                <span className="rounded-full border px-2 py-1 text-xs font-medium">
                  {task.status.replace(/_/g, " ")}
                </span>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <div className="grid gap-3 md:grid-cols-3">
                <div>
                  <p className="text-xs text-muted-foreground">Pickup</p>
                  <p className="font-medium">{format(toZonedTime(task.pickupDate, TZ), "EEE dd MMM yyyy")}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Drop off</p>
                  <p className="font-medium">{format(toZonedTime(task.dropoffDate, TZ), "EEE dd MMM yyyy")}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Property</p>
                  <p className="font-medium">{task.property.suburb}</p>
                </div>
              </div>
              <div className="space-y-2">
                {task.confirmations.map((confirmation) => (
                  <div key={confirmation.id} className="rounded-lg border bg-muted/20 p-3">
                    <p className="font-medium">{format(confirmation.createdAt, "dd MMM yyyy HH:mm")}</p>
                    <p className="text-xs text-muted-foreground">
                      {confirmation.laundryReady ? "Cleaner sent ready update" : "Laundry event recorded"}
                      {confirmation.bagLocation ? ` • ${confirmation.bagLocation}` : ""}
                    </p>
                    {task.skipReasonCode ? (
                      <p className="text-xs text-muted-foreground">Reason: {task.skipReasonCode.replace(/_/g, " ")}</p>
                    ) : null}
                    {task.skipReasonNote ? (
                      <p className="text-xs text-muted-foreground">{task.skipReasonNote}</p>
                    ) : null}
                    {task.adminOverrideNote ? (
                      <p className="text-xs font-medium text-amber-700">Admin note: {task.adminOverrideNote}</p>
                    ) : null}
                    {portal.visibility.showLaundryImages && confirmation.photoUrl ? (
                      <MediaGallery
                        items={[
                          {
                            id: `${confirmation.id}-photo`,
                            url: confirmation.photoUrl,
                            label: confirmation.laundryReady ? "Laundry ready image" : "Laundry update image",
                            mediaType: "PHOTO",
                          },
                        ]}
                        title={`${task.property.name} laundry image`}
                        className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4"
                      />
                    ) : null}
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        ))}
        {tasks.length === 0 ? (
          <Card>
            <CardContent className="p-6 text-sm text-muted-foreground">
              No laundry schedule updates found for this client account.
            </CardContent>
          </Card>
        ) : null}
      </div>
    </div>
  );
}
