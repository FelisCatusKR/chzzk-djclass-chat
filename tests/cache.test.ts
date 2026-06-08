import { describe, it, expect, beforeEach } from 'vitest'
import {
  setDjClassCache,
  getDjClassFromCache,
  invalidateAllUserCaches,
} from '../src/lib/cache'

const linked = {
  djClass: '4B SHOWSTOPPER II',
  rankName: 'SHOWSTOPPER',
  rankLevel: 'II',
  powerInteger: 9800,
}

describe('cache invalidation', () => {
  beforeEach(() => {
    setDjClassCache('id:abc:auto', linked)
    setDjClassCache('id:abc:viewer', linked)
    setDjClassCache('nick:Nick:auto', linked)
    setDjClassCache('nick:Nick:viewer', linked)
  })

  it('clears both auto and viewer variants for id and nickname', () => {
    invalidateAllUserCaches('abc', 'Nick')
    expect(getDjClassFromCache('id:abc:auto')).toBeUndefined()
    expect(getDjClassFromCache('id:abc:viewer')).toBeUndefined()
    expect(getDjClassFromCache('nick:Nick:auto')).toBeUndefined()
    expect(getDjClassFromCache('nick:Nick:viewer')).toBeUndefined()
  })
})
