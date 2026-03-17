import { db } from "@/lib/db";
import type { LaundryInvoiceData } from "@/lib/laundry/invoice";

type LaundryReportAction = "PREVIEW" | "DOWNLOAD" | "EMAIL";

interface LogLaundryReportActivityInput {
  userId: string;
  action: LaundryReportAction;
  data: LaundryInvoiceData;
  recipient?: string | null;
  ipAddress?: string | null;
}

function buildEntityId(data: LaundryInvoiceData) {
  if (data.rows.length === 1) {
    return data.rows[0].taskId;
  }
  return `${data.period}:${data.start.toISOString()}:${data.end.toISOString()}:${data.propertyId ?? "all"}`;
}

export async function logLaundryReportActivity(input: LogLaundryReportActivityInput) {
  const { data } = input;
  const primaryRow = data.rows[0] ?? null;

  await db.auditLog.create({
    data: {
      userId: input.userId,
      jobId: primaryRow?.jobId,
      action: `LAUNDRY_REPORT_${input.action}`,
      entity: "LaundryReport",
      entityId: buildEntityId(data),
      ipAddress: input.ipAddress ?? undefined,
      after: {
        mode: primaryRow ? "single_task" : "batch",
        period: data.period,
        startDate: data.start.toISOString(),
        endDate: data.end.toISOString(),
        propertyId: data.propertyId ?? null,
        propertyName: data.propertyName ?? null,
        taskId: primaryRow?.taskId ?? null,
        rowCount: data.rows.length,
        totalAmount: data.totalAmount,
        recipient: input.recipient?.trim() || null,
      } as any,
    },
  });
}
