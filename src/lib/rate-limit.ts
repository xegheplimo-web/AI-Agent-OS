/* ------------------------------------------------------------------ */
/* In-memory login rate limiter.                                       */
/*                                                                     */
/* Prevents brute-force password guessing. Tracks failed attempts per   */
/* (username + IP) tuple. After MAX_FAILED_ATTEMPTS within the window,  */
/* the account is locked out for LOCKOUT_MS. Successful login clears    */
/* the counter.                                                        */
/*                                                                     */
/* This is intentionally in-memory (not Redis) so it works without      */
/* external deps. For multi-instance deployments, replace with Redis-   */
/* backed rate limiting.                                               */
/* ------------------------------------------------------------------ */

interface AttemptRecord {
  failures: number;
  firstFailureAt: number;
  lockedUntil: number;
}

const MAX_FAILED_ATTEMPTS = 5;
const WINDOW_MS = 15 * 60 * 1000; // 15 min
const LOCKOUT_MS = 15 * 60 * 1000; // 15 min lockout

const store = new Map<string, AttemptRecord>();

/* Periodic cleanup of expired entries to prevent unbounded growth. */
const CLEANUP_INTERVAL_MS = 5 * 60 * 1000;
let lastCleanup = Date.now();

function cleanup() {
  const now = Date.now();
  if (now - lastCleanup < CLEANUP_INTERVAL_MS) return;
  lastCleanup = now;
  for (const [key, rec] of store) {
    if (now > rec.lockedUntil && now - rec.firstFailureAt > WINDOW_MS) {
      store.delete(key);
    }
  }
}

function key(username: string, ip: string): string {
  return `${username.toLowerCase()}:${ip}`;
}

/** Returns true if the (username, ip) tuple is currently locked out. */
export function isLockedOut(username: string, ip: string): boolean {
  cleanup();
  const rec = store.get(key(username, ip));
  if (!rec) return false;
  return Date.now() < rec.lockedUntil;
}

/** Returns remaining lockout seconds, or 0. */
export function lockoutRemainingSec(username: string, ip: string): number {
  const rec = store.get(key(username, ip));
  if (!rec) return 0;
  const remaining = Math.ceil((rec.lockedUntil - Date.now()) / 1000);
  return Math.max(0, remaining);
}

/** Record a failed login attempt. Locks out after MAX_FAILED_ATTEMPTS. */
export function recordFailedLogin(username: string, ip: string): void {
  cleanup();
  const k = key(username, ip);
  const now = Date.now();
  const existing = store.get(k);
  if (!existing || now - existing.firstFailureAt > WINDOW_MS) {
    store.set(k, { failures: 1, firstFailureAt: now, lockedUntil: 0 });
    return;
  }
  existing.failures += 1;
  if (existing.failures >= MAX_FAILED_ATTEMPTS) {
    existing.lockedUntil = now + LOCKOUT_MS;
  }
}

/** Clear the failure counter on successful login. */
export function recordSuccessfulLogin(username: string, ip: string): void {
  store.delete(key(username, ip));
}
