import { Logger } from '@nestjs/common';
import Redis from 'ioredis';

// Shared Redis-backed cache helper, same REDIS_URL/fallback shape already
// used for rate-limit storage (see app.module.ts's buildThrottlerStorage).
// A bounded in-memory Map everywhere by default — fine for a single
// instance, but per-process and unbounded if callers don't cap it
// themselves — becomes a shared, evicting (via TTL) cache the moment
// REDIS_URL is set, with no code change needed at the call site.
//
// One lazily-created ioredis connection is reused across every
// BoundedCache instance in the process rather than opening one per cache.
let sharedClient: Redis | undefined;
let sharedClientUrl: string | undefined;

function getRedisClient(): Redis | undefined {
  const url = process.env.REDIS_URL;
  if (!url) return undefined;
  if (sharedClient && sharedClientUrl === url) return sharedClient;
  sharedClient = new Redis(url, { lazyConnect: false, maxRetriesPerRequest: 1 });
  sharedClientUrl = url;
  sharedClient.on('error', (err) => {
    new Logger('CacheStore').warn(`Redis cache connection error: ${err.message}`);
  });
  return sharedClient;
}

/**
 * A TTL cache that's bounded + per-process when REDIS_URL is unset, and
 * bounded + shared across instances (via Redis TTL) when it is. Values
 * must be JSON-serialisable.
 */
export class BoundedCache<T> {
  private readonly memory = new Map<string, { value: T; expiresAt: number }>();

  constructor(
    private readonly keyPrefix: string,
    private readonly ttlMs: number,
    private readonly maxEntries: number,
  ) {}

  async get(key: string): Promise<T | undefined> {
    const redis = getRedisClient();
    if (redis) {
      const raw = await redis.get(`${this.keyPrefix}:${key}`).catch(() => null);
      return raw ? (JSON.parse(raw) as T) : undefined;
    }
    const entry = this.memory.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt <= Date.now()) {
      this.memory.delete(key);
      return undefined;
    }
    return entry.value;
  }

  async set(key: string, value: T): Promise<void> {
    const redis = getRedisClient();
    if (redis) {
      await redis
        .set(`${this.keyPrefix}:${key}`, JSON.stringify(value), 'PX', this.ttlMs)
        .catch(() => {});
      return;
    }
    if (this.memory.size >= this.maxEntries && !this.memory.has(key)) {
      const oldestKey = this.memory.keys().next().value;
      if (oldestKey !== undefined) this.memory.delete(oldestKey);
    }
    this.memory.set(key, { value, expiresAt: Date.now() + this.ttlMs });
  }
}
