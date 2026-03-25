import { Prisma, Role } from "@prisma/client";

type ClientContactLike = {
  email?: string | null;
  users?: Array<{ email?: string | null } | null> | null;
};

function trimPhone(value: string | null | undefined) {
  if (typeof value !== "string") return null;
  const next = value.trim();
  return next.length > 0 ? next : null;
}

export function normalizeClientEmail(value: string | null | undefined) {
  if (typeof value !== "string") return null;
  const next = value.trim().toLowerCase();
  return next.length > 0 ? next : null;
}

export function resolveClientContactEmail(client: ClientContactLike | null | undefined) {
  if (!client) return null;
  if (Array.isArray(client.users)) {
    for (const user of client.users) {
      const normalized = normalizeClientEmail(user?.email ?? null);
      if (normalized) return normalized;
    }
  }
  return normalizeClientEmail(client.email ?? null);
}

export async function syncPrimaryClientUserFromClient(
  tx: Prisma.TransactionClient,
  input: {
    clientId: string;
    name?: string | null;
    email?: string | null;
    phone?: string | null;
  }
) {
  const primaryUser = await tx.user.findFirst({
    where: { clientId: input.clientId, role: Role.CLIENT },
    orderBy: [{ createdAt: "asc" }],
    select: { id: true, email: true, name: true, phone: true },
  });
  if (!primaryUser) return null;

  const data: Record<string, unknown> = {};
  if (input.name !== undefined) {
    const name = input.name?.trim() || null;
    if (name && name !== (primaryUser.name ?? null)) data.name = name;
  }
  if (input.phone !== undefined) {
    const phone = trimPhone(input.phone);
    if (phone !== (primaryUser.phone ?? null)) data.phone = phone;
  }
  if (input.email !== undefined) {
    const nextEmail = normalizeClientEmail(input.email);
    const currentEmail = normalizeClientEmail(primaryUser.email);
    if (nextEmail && nextEmail !== currentEmail) {
      const conflict = await tx.user.findUnique({
        where: { email: nextEmail },
        select: { id: true },
      });
      if (conflict && conflict.id !== primaryUser.id) {
        throw new Error("CLIENT_CONTACT_EMAIL_IN_USE");
      }
      data.email = nextEmail;
    }
  }

  if (Object.keys(data).length === 0) return primaryUser.id;
  await tx.user.update({
    where: { id: primaryUser.id },
    data,
  });
  return primaryUser.id;
}

export async function syncClientContactFromPrimaryUser(
  tx: Prisma.TransactionClient,
  input: {
    clientId: string;
    userId: string;
    email?: string | null;
    phone?: string | null;
  }
) {
  const primaryUser = await tx.user.findFirst({
    where: { clientId: input.clientId, role: Role.CLIENT },
    orderBy: [{ createdAt: "asc" }],
    select: { id: true },
  });
  if (!primaryUser || primaryUser.id !== input.userId) return false;

  const data: Record<string, unknown> = {};
  if (input.email !== undefined) data.email = normalizeClientEmail(input.email);
  if (input.phone !== undefined) data.phone = trimPhone(input.phone);
  if (Object.keys(data).length === 0) return false;

  await tx.client.update({
    where: { id: input.clientId },
    data,
  });
  return true;
}
