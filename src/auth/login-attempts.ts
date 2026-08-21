const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_WINDOW_MS = 15 * 60 * 1000;
const CLEANUP_INTERVAL_MS = 60 * 1000;
const MAX_TRACKED_KEYS = 10_000;
const TARGET_TRACKED_KEYS_AFTER_TRIM = 8_000;

type AttemptRecord = {
  count: number;
  lockedUntil?: number;
  updatedAt: number;
};

const attempts = new Map<string, AttemptRecord>();
let nextCleanupAt = 0;

export type LoginAttemptStatus =
  | { allowed: true; remainingAttempts: number }
  | { allowed: false; retryAfterSeconds: number };

export function checkLoginAttempt(key: string, now = Date.now()): LoginAttemptStatus {
  pruneExpiredAttempts(now);
  const record = attempts.get(key);
  if (!record) {
    return { allowed: true, remainingAttempts: MAX_FAILED_ATTEMPTS };
  }

  if (record.lockedUntil && record.lockedUntil > now) {
    return {
      allowed: false,
      retryAfterSeconds: Math.ceil((record.lockedUntil - now) / 1000)
    };
  }

  if (isExpired(record, now)) {
    attempts.delete(key);
    return { allowed: true, remainingAttempts: MAX_FAILED_ATTEMPTS };
  }

  return {
    allowed: true,
    remainingAttempts: Math.max(0, MAX_FAILED_ATTEMPTS - record.count)
  };
}

export function recordFailedLoginAttempt(key: string, now = Date.now()): LoginAttemptStatus {
  pruneExpiredAttempts(now);
  const current = attempts.get(key);
  const nextCount = !current || isExpired(current, now) ? 1 : current.count + 1;

  if (nextCount >= MAX_FAILED_ATTEMPTS) {
    const retryAfterSeconds = Math.ceil(LOCKOUT_WINDOW_MS / 1000);
    attempts.set(key, {
      count: nextCount,
      lockedUntil: now + LOCKOUT_WINDOW_MS,
      updatedAt: now
    });
    return { allowed: false, retryAfterSeconds };
  }

  attempts.set(key, {
    count: nextCount,
    updatedAt: now
  });
  trimAttemptMap();
  return {
    allowed: true,
    remainingAttempts: MAX_FAILED_ATTEMPTS - nextCount
  };
}

export function clearLoginAttempts(key: string): void {
  attempts.delete(key);
}

export function resetLoginAttemptsForTests(): void {
  attempts.clear();
  nextCleanupAt = 0;
}

function isExpired(record: AttemptRecord, now: number): boolean {
  if (record.lockedUntil) return record.lockedUntil <= now;
  return record.updatedAt + LOCKOUT_WINDOW_MS <= now;
}

function pruneExpiredAttempts(now: number): void {
  if (now < nextCleanupAt && attempts.size < MAX_TRACKED_KEYS) return;

  attempts.forEach((record, key) => {
    if (isExpired(record, now)) attempts.delete(key);
  });
  nextCleanupAt = now + CLEANUP_INTERVAL_MS;
  trimAttemptMap();
}

function trimAttemptMap(): void {
  if (attempts.size <= MAX_TRACKED_KEYS) return;

  const oldestKeys = Array.from(attempts.entries())
    .sort((left, right) => left[1].updatedAt - right[1].updatedAt)
    .slice(0, attempts.size - TARGET_TRACKED_KEYS_AFTER_TRIM)
    .map(([key]) => key);
  oldestKeys.forEach((key) => attempts.delete(key));
}
