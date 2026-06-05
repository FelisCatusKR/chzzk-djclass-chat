import { describe, it, expect, vi, beforeEach } from 'vitest'
import { getHighestDjClass, getDjClass } from '../src/lib/varchive'

// Mock global fetch
global.fetch = vi.fn()

describe('V-ARCHIVE API', () => {
  beforeEach(() => {
    vi.mocked(fetch).mockClear()
  })

  it('should return the button with the highest djPowerConversion', async () => {
    const mockFetch = vi.mocked(fetch)
    
    // 4-button: lower score
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        success: true,
        djClass: 'HIGH CLASS I',
        djPowerSum: 5000.0,
        djPowerConversion: 5500.0,
        maxDjPower: 6000.0,
      }),
    } as Response)
    // 5-button: highest djPowerConversion
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        success: true,
        djClass: 'HIGH CLASS II',
        djPowerSum: 7000.0,
        djPowerConversion: 8385.9047,
        maxDjPower: 9190.92,
      }),
    } as Response)
    // 6-button: fails
    mockFetch.mockRejectedValueOnce(new Error('Not found'))
    // 8-button: lower djPowerConversion than 5-button
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        success: true,
        djClass: 'HIGH CLASS I',
        djPowerSum: 8000.0,
        djPowerConversion: 6000.0,
        maxDjPower: 7000.0,
      }),
    } as Response)

    const result = await getHighestDjClass('testuser')
    expect(result?.djClass).toBe('HIGH CLASS II')
    expect(result?.button).toBe(5)
    expect(result?.djPowerConversion).toBe(8385.9047)
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
