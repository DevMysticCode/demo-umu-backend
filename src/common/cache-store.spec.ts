import { BoundedCache } from './cache-store';

describe('BoundedCache (in-memory fallback, REDIS_URL unset)', () => {
  beforeEach(() => {
    delete process.env.REDIS_URL;
  });

  it('returns undefined for a missing key', async () => {
    const cache = new BoundedCache<string>('test', 1000, 10);
    expect(await cache.get('missing')).toBeUndefined();
  });

  it('stores and retrieves a value', async () => {
    const cache = new BoundedCache<{ n: number }>('test', 1000, 10);
    await cache.set('a', { n: 1 });
    expect(await cache.get('a')).toEqual({ n: 1 });
  });

  it('expires a value past its TTL', async () => {
    const cache = new BoundedCache<string>('test', 10, 10);
    await cache.set('a', 'value');
    await new Promise((r) => setTimeout(r, 20));
    expect(await cache.get('a')).toBeUndefined();
  });

  it('evicts the oldest entry once maxEntries is exceeded', async () => {
    const cache = new BoundedCache<number>('test', 60_000, 3);
    await cache.set('a', 1);
    await cache.set('b', 2);
    await cache.set('c', 3);
    await cache.set('d', 4); // should evict 'a'

    expect(await cache.get('a')).toBeUndefined();
    expect(await cache.get('b')).toBe(2);
    expect(await cache.get('c')).toBe(3);
    expect(await cache.get('d')).toBe(4);
  });

  it('does not evict when re-setting an existing key at capacity', async () => {
    const cache = new BoundedCache<number>('test', 60_000, 2);
    await cache.set('a', 1);
    await cache.set('b', 2);
    await cache.set('a', 10); // update, not a new entry

    expect(await cache.get('a')).toBe(10);
    expect(await cache.get('b')).toBe(2);
  });
});
