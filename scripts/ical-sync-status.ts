/** Read-only runtime evidence; never imports or starts workers/boss.ts. */
import { db } from "@/lib/db";
import { readIcalAutomationStatus } from "@/lib/ical/automation-status";

async function main() {
  const status = await readIcalAutomationStatus();
  console.log(JSON.stringify({ capturedAt: new Date().toISOString(), ...status }, null, 2));
  if (!status.worker?.icalSyncActive || !status.historyAvailable) process.exitCode = 1;
}
main().catch(() => {
  console.error("iCal runtime status unavailable. Check database connectivity and deployed schema.");
  process.exitCode = 1;
}).finally(() => db.$disconnect());
