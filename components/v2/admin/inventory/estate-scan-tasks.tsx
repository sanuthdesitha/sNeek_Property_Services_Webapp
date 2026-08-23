"use client";

/**
 * ESTATE scan tasks — the office asking a named person to go and count a
 * property, and the list of who still owes one.
 *
 * The ScanTask model and /api/scan-tasks existed before this screen did, which
 * meant nobody could create a task and nobody could see one outstanding. This
 * is the whole visible half of that feature:
 *   GET  /api/scan-tasks                                   → { tasks }
 *   POST /api/scan-tasks { propertyId, assigneeId, … }      → { task, notified }
 *
 * `notified` is reported to the asker VERBATIM. A false there means the email
 * never left, so the assignee has no idea they were asked — telling the admin
 * "they've been notified" in that case is the one lie that guarantees the count
 * never happens.
 *
 * Property and people lists are fetched here rather than passed down, because
 * this tab is one branch of a server page that would otherwise pay for both
 * queries on every other tab.
 */
import { useEffect, useMemo, useState } from "react";
import { ClipboardCheck, ClipboardList, Plus } from "lucide-react";
import { fromZonedTime } from "date-fns-tz";
import { toast } from "@/hooks/use-toast";
import { EBadge, EButton, ECard, EStatCard } from "@/components/v2/ui/primitives";
import {
  EField,
  EInput,
  EModal,
  ESelect,
  ETableShell,
  ETextarea,
} from "@/components/v2/admin/estate-kit";

const TASKS_API = "/api/scan-tasks";
const PROPERTIES_API = "/api/admin/properties?includeOneOff=1";
const CLEANERS_API = "/api/admin/users?role=CLEANER";

const SYDNEY_TZ = "Australia/Sydney";

type ScanTask = {
  id: string;
  instructions: string | null;
  dueAt: string | null;
  startedAt: string | null;
  completedAt: string | null;
  completedByCountAt: string | null;
  createdAt: string;
  property: { id: string; name: string | null; suburb: string | null } | null;
  assignee: { id: string; name: string | null; email: string } | null;
  requestedBy: { id: string; name: string | null } | null;
};

type PropertyOption = { id: string; name: string | null; suburb: string | null };
type PersonOption = { id: string; name: string | null; email: string };

/** Every date a human reads here is Sydney local — the crew is in one state. */
const fmtDay = (value: string | null) =>
  value
    ? new Intl.DateTimeFormat("en-AU", {
        timeZone: SYDNEY_TZ,
        day: "2-digit",
        month: "short",
      }).format(new Date(value))
    : "—";

/**
 * <input type="date"> hands back a bare YYYY-MM-DD with no zone, and the API
 * wants a real instant. Anchor it to the END of that day in Sydney: a task due
 * "the 5th" is not overdue at one minute past midnight on the 5th, and naive
 * `new Date(value)` would have parsed it as midnight UTC — the previous
 * afternoon here.
 */
function dueDateToIso(day: string): string {
  return fromZonedTime(`${day}T23:59:59`, SYDNEY_TZ).toISOString();
}

function personLabel(person: { name: string | null; email?: string } | null): string {
  if (!person) return "—";
  return person.name?.trim() || person.email || "—";
}

function propertyLabel(property: PropertyOption | null): string {
  if (!property) return "Unknown property";
  return [property.name, property.suburb].filter(Boolean).join(" · ") || "Unnamed property";
}

export function EstateScanTasks() {
  const [tasks, setTasks] = useState<ScanTask[]>([]);
  const [properties, setProperties] = useState<PropertyOption[]>([]);
  const [people, setPeople] = useState<PersonOption[]>([]);
  const [loading, setLoading] = useState(true);

  const [showAsk, setShowAsk] = useState(false);
  const [propertyId, setPropertyId] = useState("");
  const [assigneeId, setAssigneeId] = useState("");
  const [dueDay, setDueDay] = useState("");
  const [instructions, setInstructions] = useState("");
  const [asking, setAsking] = useState(false);

  async function loadTasks() {
    setLoading(true);
    try {
      const res = await fetch(TASKS_API, { cache: "no-store" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast({
          title: "Stock counts failed to load",
          description: body.error ?? "The list could not be fetched.",
          variant: "destructive",
        });
        return;
      }
      setTasks(Array.isArray(body.tasks) ? body.tasks : []);
    } catch (err: any) {
      toast({
        title: "Stock counts failed to load",
        description: err?.message ?? "The list could not be fetched.",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  }

  /**
   * Both pickers, fetched once. A failure here is surfaced rather than left as
   * an empty dropdown — an admin staring at "no properties" would otherwise
   * conclude the portfolio is gone rather than that a request 500'd.
   */
  async function loadPickers() {
    try {
      const [propRes, peopleRes] = await Promise.all([
        fetch(PROPERTIES_API, { cache: "no-store" }),
        fetch(CLEANERS_API, { cache: "no-store" }),
      ]);
      const [propBody, peopleBody] = await Promise.all([
        propRes.json().catch(() => null),
        peopleRes.json().catch(() => null),
      ]);

      // Both routes answer with a bare ARRAY on success and `{ error }` on
      // failure, so the shape itself is the success test.
      if (propRes.ok && Array.isArray(propBody)) {
        setProperties(
          propBody.map((p: any) => ({ id: p.id, name: p.name ?? null, suburb: p.suburb ?? null })),
        );
      } else {
        toast({
          title: "Properties failed to load",
          description: propBody?.error ?? "You cannot pick a property until this loads.",
          variant: "destructive",
        });
      }

      if (peopleRes.ok && Array.isArray(peopleBody)) {
        setPeople(
          peopleBody.map((u: any) => ({ id: u.id, name: u.name ?? null, email: u.email })),
        );
      } else {
        toast({
          title: "Cleaners failed to load",
          description: peopleBody?.error ?? "You cannot pick a person until this loads.",
          variant: "destructive",
        });
      }
    } catch (err: any) {
      toast({
        title: "Could not load the pickers",
        description: err?.message ?? "Property and cleaner lists are unavailable.",
        variant: "destructive",
      });
    }
  }

  useEffect(() => {
    loadTasks();
    loadPickers();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const totals = useMemo(
    () => ({
      open: tasks.filter((t) => !t.completedAt).length,
      done: tasks.filter((t) => Boolean(t.completedAt)).length,
    }),
    [tasks],
  );

  async function askForCount() {
    if (!propertyId || !assigneeId) {
      toast({ title: "Property and person are both required", variant: "destructive" });
      return;
    }
    setAsking(true);
    try {
      const res = await fetch(TASKS_API, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          propertyId,
          assigneeId,
          instructions: instructions.trim() || undefined,
          dueAt: dueDay ? dueDateToIso(dueDay) : undefined,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast({
          title: "Could not ask for that count",
          description: body.error ?? "The request was rejected.",
          variant: "destructive",
        });
        return;
      }

      const who = people.find((p) => p.id === assigneeId);
      if (body.notified) {
        toast({
          title: "Stock count requested",
          description: `${personLabel(who ?? null)} has been emailed a link straight to the scanner.`,
        });
      } else {
        // NOT a success message. The task exists but nobody was told, so the
        // only person who can close that gap is the admin reading this.
        toast({
          title: "Requested — but the email did NOT go out",
          description: `${personLabel(who ?? null)} has not been told. Contact them directly, or the count will not happen.`,
          variant: "destructive",
        });
      }

      setShowAsk(false);
      setInstructions("");
      setDueDay("");
      await loadTasks();
    } catch (err: any) {
      toast({
        title: "Could not ask for that count",
        description: err?.message ?? "The request never reached the server.",
        variant: "destructive",
      });
    } finally {
      setAsking(false);
    }
  }

  function stateCell(task: ScanTask) {
    if (task.completedAt) {
      return (
        <div className="flex flex-col items-center gap-0.5">
          <EBadge tone="success" soft>
            Done
          </EBadge>
          <span className="text-[0.6875rem] text-[hsl(var(--e-text-faint))]">
            {fmtDay(task.completedAt)}
            {task.completedByCountAt ? " · counted" : ""}
          </span>
        </div>
      );
    }
    const overdue = task.dueAt ? new Date(task.dueAt).getTime() < Date.now() : false;
    return (
      <EBadge tone={overdue ? "danger" : task.startedAt ? "info" : "warning"} soft>
        {overdue ? "Overdue" : task.startedAt ? "Started" : "Outstanding"}
      </EBadge>
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <section className="grid grid-cols-2 gap-4">
          <EStatCard
            label="Outstanding"
            value={totals.open}
            icon={<ClipboardList className="h-4 w-4" />}
          />
          <EStatCard
            label="Completed"
            value={totals.done}
            icon={<ClipboardCheck className="h-4 w-4" />}
          />
        </section>
        <EButton size="sm" variant="gold" onClick={() => setShowAsk(true)}>
          <Plus className="h-3.5 w-3.5" /> Ask someone to count
        </EButton>
      </div>

      <ECard className="overflow-hidden p-0">
        {loading ? (
          <p className="py-16 text-center text-[0.875rem] text-[hsl(var(--e-muted-foreground))]">
            Loading…
          </p>
        ) : tasks.length === 0 ? (
          <p className="py-16 text-center text-[0.875rem] text-[hsl(var(--e-muted-foreground))]">
            Nobody has been asked to count anything yet.
          </p>
        ) : (
          <ETableShell
            headers={[
              { label: "Property" },
              { label: "Who" },
              { label: "Asked by" },
              { label: "Due", align: "center" },
              { label: "State", align: "center" },
            ]}
          >
            {tasks.map((task) => (
              <tr key={task.id} className="hover:bg-[hsl(var(--e-surface-raised))]">
                <td className="px-4 py-3">
                  <span className="font-[550] text-[hsl(var(--e-foreground))]">
                    {task.property?.name ?? "Unknown property"}
                  </span>
                  <p className="text-[0.6875rem] text-[hsl(var(--e-text-faint))]">
                    {task.property?.suburb ?? "—"}
                    {task.instructions ? ` · ${task.instructions}` : ""}
                  </p>
                </td>
                <td className="px-4 py-3 text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">
                  {personLabel(task.assignee)}
                </td>
                <td className="px-4 py-3 text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">
                  {personLabel(task.requestedBy)}
                  <span className="block text-[0.6875rem] text-[hsl(var(--e-text-faint))]">
                    {fmtDay(task.createdAt)}
                  </span>
                </td>
                <td className="px-4 py-3 text-center e-tnum text-[hsl(var(--e-muted-foreground))]">
                  {fmtDay(task.dueAt)}
                </td>
                <td className="px-4 py-3 text-center">{stateCell(task)}</td>
              </tr>
            ))}
          </ETableShell>
        )}
      </ECard>

      <EModal
        open={showAsk}
        onClose={() => setShowAsk(false)}
        eyebrow="Inventory"
        title="Ask someone to count"
      >
        <div className="space-y-4">
          <EField label="Property">
            <ESelect value={propertyId} onChange={(e) => setPropertyId(e.target.value)}>
              <option value="">Select property…</option>
              {properties.map((p) => (
                <option key={p.id} value={p.id}>
                  {propertyLabel(p)}
                </option>
              ))}
            </ESelect>
          </EField>
          <EField label="Who should count it" hint="Cleaners only — they are the ones at the cupboard.">
            <ESelect value={assigneeId} onChange={(e) => setAssigneeId(e.target.value)}>
              <option value="">Select person…</option>
              {people.map((u) => (
                <option key={u.id} value={u.id}>
                  {personLabel(u)}
                </option>
              ))}
            </ESelect>
          </EField>
          <EField label="Due date (optional)" hint="Leave blank for “when you’re next there”.">
            <EInput type="date" value={dueDay} onChange={(e) => setDueDay(e.target.value)} />
          </EField>
          <EField label="Instructions (optional)">
            <ETextarea
              value={instructions}
              onChange={(e) => setInstructions(e.target.value)}
              maxLength={4000}
              placeholder="e.g. Check the laundry cupboard too — the linen was moved."
            />
          </EField>
          <EButton
            className="w-full"
            variant="gold"
            onClick={askForCount}
            disabled={asking || !propertyId || !assigneeId}
          >
            {asking ? "Asking…" : "Send the request"}
          </EButton>
        </div>
      </EModal>
    </div>
  );
}
