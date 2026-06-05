import { LRUCache } from 'lru-cache'

type CacheValue = { djClass: string } | { unlinked: true } | { beginner: true }

const cache = new LRUCache<string, CacheValue>({
  max: 10000,
  ttl: 1000 * 60 * 5, // 5 minutes default
  updateAgeOnGet: true,
})

export function getDjClassFromCache(key: string): CacheValue | undefined {
  return cache.get(key)
}

export function setDjClassCache(key: string, value: CacheValue, ttlMinutes?: number): void {
  if (ttlMinutes) {
    cache.set(key, value, { ttl: ttlMinutes * 60 * 1000 })
  } else {
    cache.set(key, value)
  }
}

export function invalidateUserCache(chzzkId: string): void {
  cache.delete(`id:${chzzkId}`)
}

export function getCacheStats(): { size: number; hits: number; misses: number } {
  return {
    size: cache.size,
    hits: (cache as any).hits || 0,
    misses: (cache as any).misses || 0,
  }
}
