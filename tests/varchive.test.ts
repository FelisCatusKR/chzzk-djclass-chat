import { describe, it, expect, vi, beforeEach } from 'vitest'
import { getHighestDjClass, getDjClass } from '../src/lib/varchive'

// Mock global fetch
global.fetch = vi.fn()

describe('V-ARCHIVE API', () => {
  beforeEach(() => {
    vi.mocked(fetch).mockClear()
  })

  it('should try buttons in descending order and return first success', async () => {
    const mockFetch = vi.mocked(fetch)
    
    // 8-button fails
    mockFetch.mockRejectedValueOnce(new Error('Not found'))
    // 6-button succeeds
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        success: true,
        djClass: 'HIGH CLASS II',
        djPowerSum: 7707.418,
        maxDjPower: 9190.92,
      }),
    } as Response)

    const result = await getHighestDjClass('testuser')
    expect(result?.djClass).toBe('HIGH CLASS II')
    expect(mockFetch).toHaveBeenCalledTimes(2)
  })

  it('should return null if all buttons fail', async () => {
    const mockFetch = vi.mocked(fetch)
    mockFetch.mockRejectedValue(new Error('Not found'))

    const result = await getHighestDjClass('testuser')
    expect(result).toBeNull()
    expect(mockFetch).toHaveBeenCalledTimes(4)
  })
})
