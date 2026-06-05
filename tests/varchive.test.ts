import { describe, it, expect, vi, beforeEach } from 'vitest'
import { getHighestDjClass, getDjClass } from '../src/lib/varchive'

// Mock global fetch
global.fetch = vi.fn()

describe('V-ARCHIVE API', () => {
  beforeEach(() => {
    vi.mocked(fetch).mockClear()
  })

  it('should return the button with the highest djPowerSum', async () => {
    const mockFetch = vi.mocked(fetch)
    
    // 4-button: lower score
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        success: true,
        djClass: 'HIGH CLASS I',
        djPowerSum: 5000.0,
        maxDjPower: 6000.0,
      }),
    } as Response)
    // 5-button: medium score
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        success: true,
        djClass: 'HIGH CLASS II',
        djPowerSum: 7707.418,
        maxDjPower: 9190.92,
      }),
    } as Response)
    // 6-button: fails
    mockFetch.mockRejectedValueOnce(new Error('Not found'))
    // 8-button: lower than 5-button
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        success: true,
        djClass: 'HIGH CLASS I',
        djPowerSum: 6000.0,
        maxDjPower: 7000.0,
      }),
    } as Response)

    const result = await getHighestDjClass('testuser')
    expect(result?.djClass).toBe('HIGH CLASS II')
    expect(result?.button).toBe(5)
    expect(result?.djPowerSum).toBe(7707.418)
    expect(mockFetch).toHaveBeenCalledTimes(4)
  })

  it('should return null if all buttons fail', async () => {
    const mockFetch = vi.mocked(fetch)
    mockFetch.mockRejectedValue(new Error('Not found'))

    const result = await getHighestDjClass('testuser')
    expect(result).toBeNull()
    expect(mockFetch).toHaveBeenCalledTimes(4)
  })
})
