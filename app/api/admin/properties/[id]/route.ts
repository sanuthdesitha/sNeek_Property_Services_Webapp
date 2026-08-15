import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { updatePropertySchema, sanitizeSetupGuide } from "@/lib/validations/client";
import { Role } from "@prisma/client";
import { verifySensitiveAction } from "@/lib/security/admin-verification";
import { getValidationErrorMessage } from "@/lib/validations/errors";
import { decryptSecret, encryptSecret } from "@/lib/security/encryption";
import { logger } from "@/lib/logger";
import { applyLaundryPlanDraft, refreshLaundrySyncDraftForProperty } from "@/lib/laundry/planner";
import {
  clearPendingLaundrySyncDraftForProperty,
  notifyLaundryTeamsForApprovedSyncDraft,
} from "@/lib/laundry/sync-draft";
import {
  buildPropertyAccessInfo,
  pickLegacyAccessCode,
  resolvePropertyAccessCode,
} from "@/lib/properties/access-info";
import { ensurePropertyDefaultStock } from "@/lib/inventory/default-items";

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const property = await db.property.findUnique({
      where: { id: params.id },
      include: {
        client: true,
        integration: {
          include: {
            syncRuns: {
              orderBy: { createdAt: "desc" },
              take: 10,
              include: {
                triggeredBy: { select: { id: true, name: true, email: true } },
                revertedBy: { select: { id: true, name: true, email: true } },
              },
            },
          },
        },
        propertyStock: { include: { item: true } },
        _count: { select: { jobs: true, reservations: true } },
      },
    });
    if (!property) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json({
      ...property,
      accessCode: decryptSecret(property.accessCode),
      alarmCode: decryptSecret(property.alarmCode),
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 400 });
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const body = updatePropertySchema.parse(await req.json());

    // The stored row is needed for two independent reasons: to merge accessInfo
    // (a form that edits only some keys must not drop the rest — see
    // lib/properties/access-info.ts) and for key-lost bookkeeping below.
    const existing =
      body.accessInfo !== undefined || body.keyLostMode !== undefined
        ? await db.property.findUnique({
            where: { id: params.id },
            select: { keyLostMode: true, accessInfo: true },
          })
        : null;
    const normalizedAccessInfo = buildPropertyAccessInfo(
      body as Record<string, unknown>,
      existing?.accessInfo
    );

    // Key-lost mode bookkeeping: keyLostSince is server-managed — stamped when
    // the mode turns ON, cleared when it turns OFF, untouched otherwise.
    const keyLostModeChanged =
      body.keyLostMode !== undefined && existing !== null && body.keyLostMode !== existing.keyLostMode;

    const property = await db.property.update({
      where: { id: params.id },
      data: {
        ...body,
        latitude: body.latitude ?? undefined,
        longitude: body.longitude ?? undefined,
        placeId: body.placeId ?? undefined,
        // The door code may arrive in either the flat `accessCode` field or the
        // legacy `accessInfo.codes` the older property form still sends.
        // Whichever carries it, it lands in the encrypted column — accessInfo
        // no longer stores it, so ignoring the JSON here would silently discard
        // the admin's edit. Resolved from the BODY only: pulling the stored
        // JSON in would let a stale plaintext code overwrite a newer one.
        accessCode:
          body.accessCode !== undefined || pickLegacyAccessCode(body.accessInfo) !== null
            ? encryptSecret(resolvePropertyAccessCode(body as Record<string, unknown>))
            : undefined,
        alarmCode:
          body.alarmCode !== undefined
            ? encryptSecret(body.alarmCode ?? "")
            : undefined,
        keyLocation:
          body.keyLocation !== undefined
            ? body.keyLocation?.trim() || normalizedAccessInfo.lockbox || null
            : undefined,
        accessNotes:
          body.accessNotes !== undefined
            ? body.accessNotes?.trim() || normalizedAccessInfo.accessNotesSummary || null
            : undefined,
        accessInfo: body.accessInfo !== undefined ? (normalizedAccessInfo as any) : undefined,
        preferredCleanerUserId: body.preferredCleanerUserId ?? undefined,
        setupGuide:
          body.setupGuide !== undefined ? (sanitizeSetupGuide(body.setupGuide) as any) : undefined,
        keyLostSince: keyLostModeChanged ? (body.keyLostMode ? new Date() : null) : undefined,
      },
    });

    // Turning stock tracking ON has to actually give the property something to
    // track. Flipping the flag was historically the ONLY thing that happened
    // here (and in the 2026-08 enable_inventory_on_active_properties backfill),
    // which is why properties sat at inventoryEnabled = true with zero
    // PropertyStock rows and an empty supplies screen. Seeding on "flag is true
    // AND nothing is tracked" also self-heals the ones already in that state,
    // and the count keeps it a no-op for every property that is already stocked.
    if (body.inventoryEnabled === true) {
      try {
        const trackedItems = await db.propertyStock.count({ where: { propertyId: params.id } });
        if (trackedItems === 0) {
          const { created } = await ensurePropertyDefaultStock(params.id);
          logger.info(
            { propertyId: params.id, created },
            "Seeded default inventory for a property with stock tracking enabled and no stock rows"
          );
        }
      } catch (stockError: any) {
        logger.error(
          { err: stockError, propertyId: params.id },
          "Default inventory seeding after enabling stock tracking failed — the property save itself succeeded"
        );
      }
    }

    // Toggling key-lost mode reschedules this property's future laundry in
    // BOTH directions (into same-clean-day service, or back to the normal
    // day-after/day-before window). Same refresh→apply→notify→clear flow the
    // iCal sync uses; completed/in-flight tasks are protected inside the
    // planner (canPlannerOverrideStatus). Failures must not fail the save.
    if (keyLostModeChanged) {
      try {
        const draft = await refreshLaundrySyncDraftForProperty({ propertyId: params.id });
        const items = draft.items.filter((item) => item.sourcePropertyId === params.id);
        if (items.length > 0) {
          await applyLaundryPlanDraft(items);
          await notifyLaundryTeamsForApprovedSyncDraft(items);
          await clearPendingLaundrySyncDraftForProperty(params.id);
        }
      } catch (laundryError: any) {
        logger.error(
          { err: laundryError, propertyId: params.id, keyLostMode: body.keyLostMode },
          "Laundry reschedule after key-lost mode toggle failed"
        );
      }
    }

    return NextResponse.json(property);
  } catch (err: any) {
    const status = err.message === "UNAUTHORIZED" ? 401 : err.message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json({ error: getValidationErrorMessage(err, "Could not update property.") }, { status });
  }
}

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const body = await req.json().catch(() => ({}));
    await verifySensitiveAction(session.user.id, body?.security);
    await db.property.update({ where: { id: params.id }, data: { isActive: false } });
    await db.auditLog.create({
      data: {
        userId: session.user.id,
        action: "DEACTIVATE_PROPERTY",
        entity: "Property",
        entityId: params.id,
      },
    });
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    const status =
      err.message === "UNAUTHORIZED"
        ? 401
        : err.message === "FORBIDDEN"
          ? 403
          : err.message === "INVALID_SECURITY_VERIFICATION" || err.message === "PIN_OR_PASSWORD_REQUIRED"
            ? 423
            : 400;
    return NextResponse.json({ error: err.message }, { status });
  }
}
