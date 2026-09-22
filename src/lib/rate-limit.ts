import { NextResponse } from "next/server";

// Sliding-window request limits per IP and key.
// Counts live in memory, so each serverless instance keeps its own: a burst limit, not a global quota.

export interface RateLimit {
  limit: number;
  windowMs: number;
}

const MINUTE = 60_000;

export const LIMITS = {
  signUp: { limit: 5, windowMs: 60 * MINUTE },
  signIn: { limit: 20, windowMs: 10 * MINUTE },
  signInAccount: { limit: 10, windowMs: 10 * MINUTE },
  resendVerification: { limit: 5, windowMs: 60 * MINUTE },
  aiExplain: { limit: 20, windowMs: 5 * MINUTE },
  pushTest: { limit: 5, windowMs: 10 * MINUTE },
  replay: { limit: 10, windowMs: 10 * MINUTE },
  climateHistory: { limit: 30, windowMs: 10 * MINUTE },
} satisfies Record<string, RateLimit>;

export type LimitName = keyof typeof LIMITS;

export interface RateLimitResult {
  ok: boolean;
  remaining: number;
  retryAfterSeconds: number;
}

export class SlidingWindowLimiter {
  private readonly hits = new Map<string, number[]>();

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
    private readonly maxKeys = 10_000,
  ) {}

  /** Records a request for the key unless the key is already at its limit. */
  check(key: string, now = Date.now()): RateLimitResult {
    const since = now - this.windowMs;
    const recent = (this.hits.get(key) ?? []).filter((at) => at > since);
    if (recent.length >= this.limit) {
      this.hits.set(key, recent);
      return {
        ok: false,
        remaining: 0,
        retryAfterSeconds: Math.max(1, Math.ceil((recent[0] + this.windowMs - now) / 1000)),
      };
    }
    recent.push(now);
    // Re-inserting keeps the map ordered by last use, oldest first.
    this.hits.delete(key);
    this.hits.set(key, recent);
    if (this.hits.size > this.maxKeys) this.prune(now);
    return { ok: true, remaining: this.limit - recent.length, retryAfterSeconds: 0 };
  }

  get size(): number {
    return this.hits.size;
  }

  private prune(now: number) {
    const since = now - this.windowMs;
    for (const [key, times] of this.hits) {
      if (!times.length || times[times.length - 1] <= since) this.hits.delete(key);
    }
    for (const key of this.hits.keys()) {
      if (this.hits.size <= this.maxKeys) break;
      this.hits.delete(key);
    }
  }
}

const limiters = new Map<LimitName, SlidingWindowLimiter>();

function limiter(name: LimitName): SlidingWindowLimiter {
  let found = limiters.get(name);
  if (!found) {
    found = new SlidingWindowLimiter(LIMITS[name].limit, LIMITS[name].windowMs);
    limiters.set(name, found);
  }
  return found;
}

/** The caller's address as the platform reports it: the first x-forwarded-for entry. */
export function clientIp(req: Request): string {
  const forwarded = req.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0].trim();
  return req.headers.get("x-real-ip")?.trim() || "unknown";
}

function tooMany(result: RateLimitResult): NextResponse {
  return NextResponse.json(
    { error: "rate_limited", retry_after_seconds: result.retryAfterSeconds },
    { status: 429, headers: { "Retry-After": String(result.retryAfterSeconds) } },
  );
}

/**
 * Counts the request against a named limit, per IP and optional key, and
 * returns the 429 response to send once the limit is reached.
 */
export function rateLimit(req: Request, name: LimitName, key = ""): NextResponse | null {
  const result = limiter(name).check(`${clientIp(req)}|${key}`);
  return result.ok ? null : tooMany(result);
}

/** The same, for a key on its own whatever the IP, such as one account. */
export function rateLimitKey(name: LimitName, key: string): NextResponse | null {
  const result = limiter(name).check(key);
  return result.ok ? null : tooMany(result);
}
