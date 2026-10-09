import {
  Package,
  Truck,
  PackageCheck,
  AlertTriangle,
  CalendarDays,
  UserRoundCheck,
  Route,
  Sparkles,
  ClipboardCheck,
  CircleCheck,
  ReceiptText,
  Pause,
  ShieldAlert,
  Send,
  CircleHelp,
} from "lucide-react";
import { jobProgress } from "@/lib/jobs/status-presentation";

const icons = [
  CalendarDays,
  UserRoundCheck,
  Route,
  Sparkles,
  ClipboardCheck,
  CircleCheck,
  ReceiptText,
];
const motions = [
  "plan",
  "assign",
  "travel",
  "clean",
  "review",
  "complete",
  "invoice",
];

/** Decorative vectors: the adjacent written status supplies the accessible name. */
export function JobStatusIcon({
  status,
  animate = true,
  domain = "job",
}: {
  status: string;
  domain?: "job" | "laundry" | "qa";
  animate?: boolean;
}) {
  const laundryIcons: Record<string, typeof Package> = { PENDING: Package, CONFIRMED: ClipboardCheck, PICKED_UP: Truck, DROPPED: PackageCheck, FLAGGED: AlertTriangle, SKIPPED_PICKUP: Pause };
  const laundryMotions: Record<string, string> = { PENDING: "plan", CONFIRMED: "assign", PICKED_UP: "travel", DROPPED: "complete", FLAGGED: "waiting", SKIPPED_PICKUP: "paused" };
  const normalized = domain === "qa" ? ({ OPEN: "UNASSIGNED", IN_PROGRESS: "QA_REVIEW", CANCELLED: "PAUSED" }[status] ?? status) : status;
  const { step } = jobProgress(normalized);
  const JobIcon =
    normalized === "PAUSED"
      ? Pause
      : normalized === "WAITING_CONTINUATION_APPROVAL"
        ? ShieldAlert
        : normalized === "OFFERED"
          ? Send
          : step === null
            ? CircleHelp
            : icons[step];
  const jobMotion =
    normalized === "PAUSED"
      ? "paused"
      : normalized === "WAITING_CONTINUATION_APPROVAL"
        ? "waiting"
        : normalized === "OFFERED"
          ? "offered"
          : step === null
            ? "unknown"
            : motions[step];
  const Icon = domain === "laundry" ? laundryIcons[status] ?? CircleHelp : JobIcon;
  const motion = domain === "laundry" ? laundryMotions[status] ?? "unknown" : jobMotion;
  return (
    <span
      aria-hidden="true"
      className="job-status-vector"
      data-motion={animate ? motion : "none"}
      key={status}
    >
      <Icon size={20} strokeWidth={1.5} />
    </span>
  );
}
