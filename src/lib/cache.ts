import { LRUCache } from 'lru-cache'

type CacheValue =
  | {
      djClass: string
      rankName: string
      rankLevel: string | null
      powerInteger: number | null
    }
  | { unlinked: true }

const cache = new LRUCache<string, CacheValue>({
  max: 10000,
  ttl: 1000 * 60 * 5, // 5 minutes default for linked users
  updateAgeOnGet: false, // TTL should not extend on active chat
})

export function getDjClassFromCache(key: string): CacheValue | undefined {
  return cache.get(key)
}

export function setDjClassCache(
  key: string,
  value: CacheValue,
  ttlMinutes?: number
): void {
  if (ttlMinutes) {
    cache.set(key, value, { ttl: ttlMinutes * 60 * 1000 })
  } else {
    cache.set(key, value)
  }
}

export function invalidateUserCache(chzzkId: string): void {
  cache.delete(`id:${chzzkId}:auto`)
  cache.delete(`id:${chzzkId}:viewer`)
}

export function invalidateNicknameCache(nickname: string): void {
  cache.delete(`nick:${nickname}:auto`)
  cache.delete(`nick:${nickname}:viewer`)
}

export function invalidateAllUserCaches(
  chzzkId: string,
  chzzkNickname?: string
): void {
  invalidateUserCache(chzzkId)
  if (chzzkNickname) {
    invalidateNicknameCache(chzzkNickname)
  }
}

export function getCacheStats(): { size: number } {
  return {
    size: cache.size,
  }
}
