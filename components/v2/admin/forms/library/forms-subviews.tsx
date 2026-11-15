/**
 * Sub-views of the Checklist blocks and Message templates tabs. Each embeds an
 * existing workspace unchanged; the chip row picks which one, in the URL
 * (`view=`), so the old pages' deep links keep their meaning.
 */
import Link from "next/link";
import { BarChart3, Bell, BookOpen, ClipboardCheck, ListChecks, MessageSquare } from "lucide-react";
import { EChipTabs } from "@/components/v2/admin/estate-kit";
import { EButton } from "@/components/v2/ui/primitives";
import { EstateChecklistLibrary } from "@/components/v2/admin/checklists/checklist-library-editor";
import { EstateChecklistsWorkspace } from "@/components/v2/admin/forms/management/estate-checklists-workspace";
import { NotificationTemplatesWorkspace } from "@/components/v2/admin/templates/notification-templates-workspace";
import { MessageTemplatesWorkspace } from "@/components/v2/admin/templates/message-templates-workspace";

export type BlocksView = "library" | "service";
export type MessagesView = "notifications" | "messages";
export type ResultsView = "stats" | "submissions";

/**
 * Results and stats: the statistics, or every submitted form (the classic
 * Forms page's Submissions tab, moved here; `view=submissions`).
 */
export function ResultsViewChips({ view }: { view: ResultsView }) {
  return (
    <EChipTabs
      tabs={[
        { key: "stats", label: "Statistics", href: "/v2/admin/forms?tab=stats", active: view === "stats", icon: <BarChart3 className="h-3.5 w-3.5" /> },
        { key: "submissions", label: "Submissions", href: "/v2/admin/forms?tab=stats&view=submissions", active: view === "submissions", icon: <ClipboardCheck className="h-3.5 w-3.5" /> },
      ]}
    />
  );
}

export function ChecklistBlocksTab({ view }: { view: BlocksView }) {
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <EChipTabs
          tabs={[
            { key: "library", label: "Checklist library", href: "/v2/admin/forms?tab=blocks&view=library", active: view === "library", icon: <BookOpen className="h-3.5 w-3.5" /> },
            { key: "service", label: "Per-service checklists", href: "/v2/admin/forms?tab=blocks&view=service", active: view === "service", icon: <ListChecks className="h-3.5 w-3.5" /> },
          ]}
        />
        <EButton variant="outline" size="sm" asChild>
          <Link href="/v2/admin/checklists/coverage">Property coverage →</Link>
        </EButton>
      </div>
      {view === "service" ? (
        <EstateChecklistsWorkspace />
      ) : (
        <>
          <p className="text-[0.875rem] text-[hsl(var(--e-muted-foreground))]">
            The master checklist database — organised by room, appliance and outdoor modules. Every property&apos;s checklist is composed from these, filtered by its amenities.
          </p>
          <EstateChecklistLibrary />
        </>
      )}
    </div>
  );
}

export function MessageTemplatesTab({ view, canWrite = true, messageCount = null }: { view: MessagesView; canWrite?: boolean; messageCount?: number | null }) {
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <EChipTabs
          className="max-w-full"
          tabs={[
            { key: "notifications", label: "Notification templates", href: "/v2/admin/forms?tab=messages&view=notifications", active: view === "notifications", icon: <Bell className="h-3.5 w-3.5" /> },
            { key: "messages", label: "Message templates", href: "/v2/admin/forms?tab=messages&view=messages", active: view === "messages", icon: <MessageSquare className="h-3.5 w-3.5" />, ...(typeof messageCount === "number" ? { count: messageCount } : {}) },
          ]}
        />
        {view === "messages" ? (
          <p className="min-w-0 text-[0.75rem] text-[hsl(var(--e-text-secondary))]">
            Wording of automatic notifications:{" "}
            <Link href="/v2/admin/notifications" className="font-[550] text-[hsl(var(--e-primary))] underline">Notifications › Types and wording</Link>
            {" · "}Email colours and layout:{" "}
            <Link href="/v2/admin/notifications/email-look" className="font-[550] text-[hsl(var(--e-primary))] underline">Notifications › Email look</Link>
          </p>
        ) : null}
      </div>
      <p className="text-[0.875rem] text-[hsl(var(--e-muted-foreground))]">
        {view === "messages"
          ? "Ready-made messages the office inserts when writing to a client, cleaner or laundry partner, and the messages client automations and campaigns send."
          : "Design the email, SMS and message copy sNeek sends across every event."}
      </p>
      {view === "messages" ? <MessageTemplatesWorkspace canWrite={canWrite} /> : <NotificationTemplatesWorkspace />}
    </div>
  );
}
