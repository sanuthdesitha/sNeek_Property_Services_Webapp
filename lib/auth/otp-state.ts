import { db } from "@/lib/db";

export const OTP_MAX_ATTEMPTS = 5;
export const OTP_LOCK_MINUTES = 15;
export const OTP_RESEND_COOLDOWN_SECONDS = 60;
export const OTP_MAX_SENDS_PER_HOUR = 8;

interface OtpState {
  failedAttempts: number;
  lockedUntil?: string;
  lastSentAt?: string;
  sendWindowStart?: string;
  sendCountInWindow: number;
}

function stateKey(identifier: string) {
  return `otpState:${identifier}`;
}

function sanitizeState(input: unknown): OtpState {
  if (!input || typeof input !== "object") {
    return {
      failedAttempts: 0,
      sendCountInWindow: 0,
    };
  }
  const row = input as Record<string, unknown>;
  return {
    failedAttempts: Number.isFinite(Number(row.failedAttempts)) ? Math.max(0, Number(row.failedAttempts)) : 0,
    lockedUntil: typeof row.lockedUntil === "string" ? row.lockedUntil : undefined,
    lastSentAt: typeof row.lastSentAt === "string" ? row.lastSentAt : undefined,
    sendWindowStart: typeof row.sendWindowStart === "string" ? row.sendWindowStart : undefined,
    sendCountInWindow: Number.isFinite(Number(row.sendCountInWindow))
      ? Math.max(0, Number(row.sendCountInWindow))
      : 0,
  };
}

async function getState(identifier: string): Promise<OtpState> {
  const row = await db.appSetting.findUnique({ where: { key: stateKey(identifier) } });
  if (!row) {
    return {
      failedAttempts: 0,
      sendCountInWindow: 0,
    };
  }
  return sanitizeState(row.value);
}

async function saveState(identifier: string, state: OtpState): Promise<void> {
  await db.appSetting.upsert({
    where: { key: stateKey(identifier) },
    create: { key: stateKey(identifier), value: state as any },
    update: { value: state as any },
  });
}

export async function clearOtpState(identifier: string): Promise<void> {
  await db.appSetting.deleteMany({ where: { key: stateKey(identifier) } });
}

export async function ensureOtpNotLocked(identifier: string): Promise<{ ok: true } | { ok: false; message: string; lockedUntil: Date }> {
  const state = await getState(identifier);
  if (!state.lockedUntil) return { ok: true };
  const lockedUntil = new Date(state.lockedUntil);
  if (!Number.isFinite(lockedUntil.getTime()) || lockedUntil.getTime() <= Date.now()) {
    await saveState(identifier, {
      ...state,
      failedAttempts: 0,
      lockedUntil: undefined,
    });
    return { ok: true };
  }
  const minutesLeft = Math.max(1, Math.ceil((lockedUntil.getTime() - Date.now()) / 60000));
  return {
    ok: false,
    lockedUntil,
    message: `Too many failed attempts. Try again in ${minutesLeft} minute(s).`,
  };
}

export async function recordOtpFailure(identifier: string): Promise<{ locked: boolean; message: string }> {
  const state = await getState(identifier);
  const failedAttempts = (state.failedAttempts ?? 0) + 1;

  if (failedAttempts >= OTP_MAX_ATTEMPTS) {
    const lockedUntil = new Date(Date.now() + OTP_LOCK_MINUTES * 60 * 1000);
    await saveState(identifier, {
      ...state,
      failedAttempts,
      lockedUntil: lockedUntil.toISOString(),
    });
    return {
      locked: true,
      message: `Too many failed attempts. OTP locked for ${OTP_LOCK_MINUTES} minutes.`,
    };
  }

  await saveState(identifier, {
    ...state,
    failedAttempts,
  });
  const left = OTP_MAX_ATTEMPTS - failedAttempts;
  return {
    locked: false,
    message: `Invalid OTP code. ${left} attempt(s) remaining before lockout.`,
  };
}

export async function recordOtpSuccess(identifier: string): Promise<void> {
  const state = await getState(identifier);
  await saveState(identifier, {
    ...state,
    failedAttempts: 0,
    lockedUntil: undefined,
  });
}

export async function assertCanResendOtp(identifier: string): Promise<{ ok: true } | { ok: false; message: string }> {
  const state = await getState(identifier);
  const now = Date.now();

  if (state.lastSentAt) {
    const lastSent = new Date(state.lastSentAt);
    if (Number.isFinite(lastSent.getTime())) {
      const secondsSinceLast = Math.floor((now - lastSent.getTime()) / 1000);
      if (secondsSinceLast < OTP_RESEND_COOLDOWN_SECONDS) {
        return {
          ok: false,
          message: `Please wait ${OTP_RESEND_COOLDOWN_SECONDS - secondsSinceLast}s before requesting another OTP.`,
        };
      }
    }
  }

  let sendWindowStart = state.sendWindowStart ? new Date(state.sendWindowStart) : null;
  let sendCountInWindow = state.sendCountInWindow ?? 0;
  if (!sendWindowStart || !Number.isFinite(sendWindowStart.getTime()) || now - sendWindowStart.getTime() > 60 * 60 * 1000) {
    sendWindowStart = new Date(now);
    sendCountInWindow = 0;
  }

  if (sendCountInWindow >= OTP_MAX_SENDS_PER_HOUR) {
    return {
      ok: false,
      message: `OTP limit reached. Try again later.`,
    };
  }

  return { ok: true };
}

export async function recordOtpSent(identifier: string): Promise<void> {
  const state = await getState(identifier);
  const now = new Date();
  const windowStart = state.sendWindowStart ? new Date(state.sendWindowStart) : null;

  const isWindowExpired =
    !windowStart || !Number.isFinite(windowStart.getTime()) || now.getTime() - windowStart.getTime() > 60 * 60 * 1000;

  await saveState(identifier, {
    ...state,
    failedAttempts: 0,
    lockedUntil: undefined,
    lastSentAt: now.toISOString(),
    sendWindowStart: isWindowExpired ? now.toISOString() : windowStart.toISOString(),
    sendCountInWindow: isWindowExpired ? 1 : (state.sendCountInWindow ?? 0) + 1,
  });
}

